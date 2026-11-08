/**
 * Calculador global: corre el mismo spigot que la web, sin parar, para
 * varias bases a la vez (por turnos), con un límite de CPU para no salirse
 * del presupuesto, y guarda el progreso en disco para sobrevivir a reinicios
 * y redespliegues.
 *
 * En disco, por base:
 *   digits-<b>.bin   un byte por dígito, solo se añade al final
 *   state-<b>.json   estado del spigot + cuántos dígitos son válidos
 *
 * Orden de escritura: primero se añaden los dígitos (con fsync) y luego se
 * reemplaza el estado (archivo temporal + rename, que es atómico). Así el
 * archivo de dígitos siempre tiene al menos tantos como dice el estado; si
 * tiene más (corte entre ambos pasos), al arrancar se recorta.
 */
import {
    open,
    mkdir,
    readFile,
    rename,
    truncate,
    writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { PiSpigot, type SpigotSnapshot } from '../src/lib/spigot.ts';

/** Duración de cada porción de cálculo (ms). */
const SLICE_MS = 40;
/** Intervalo mínimo entre guardados (ms). */
const MIN_CHECKPOINT_MS = 15_000;

interface SavedState {
    format: 1;
    base: number;
    produced: number;
    integerPart: number;
    elapsedMs: number;
    cpuMs: number;
    spigot: SpigotSnapshot;
    savedAt: number;
}

interface Meta {
    startedAt: number;
}

export type BatchListener = (
    start: number,
    digits: Uint8Array,
    elapsedMs: number,
) => void;

export class Stream {
    readonly base: number;
    readonly weight: number;
    spigot: PiSpigot;
    integerPart: number;
    /** Dígitos en memoria (capacidad ≥ length). */
    private buffer: Uint8Array;
    length = 0;
    persisted = 0;
    /** Tiempo de reloj acumulado con el servidor encendido. */
    elapsedMs = 0;
    /** Tiempo de CPU dedicado a esta base. */
    cpuMs = 0;
    readonly listeners = new Set<BatchListener>();

    constructor(
        base: number,
        weight: number,
        spigot: PiSpigot,
        integerPart: number,
        digits?: Uint8Array,
    ) {
        this.base = base;
        this.weight = weight;
        this.spigot = spigot;
        this.integerPart = integerPart;
        this.buffer = new Uint8Array(
            Math.max(1 << 16, (digits?.length ?? 0) * 2),
        );
        if (digits) {
            this.buffer.set(digits);
            this.length = digits.length;
            this.persisted = digits.length;
        }
    }

    /** Vista (sin copiar) de [from, to). */
    view(from = 0, to = this.length): Uint8Array {
        return this.buffer.subarray(
            Math.max(0, from),
            Math.min(to, this.length),
        );
    }

    append(digits: Uint8Array): void {
        if (this.length + digits.length > this.buffer.length) {
            let cap = this.buffer.length;
            while (cap < this.length + digits.length) cap *= 2;
            const bigger = new Uint8Array(cap);
            bigger.set(this.buffer.subarray(0, this.length));
            this.buffer = bigger;
        }
        const start = this.length;
        this.buffer.set(digits, start);
        this.length += digits.length;
        for (const fn of this.listeners)
            fn(start, digits, this.elapsedMs);
    }
}

export interface CalculatorOptions {
    dataDir: string;
    /** Fracción de una CPU que puede usar (0–1). */
    duty: number;
    /** Base → peso relativo en el reparto de CPU. */
    bases: Map<number, number>;
    log?: (msg: string) => void;
}

export class Calculator {
    readonly streams = new Map<number, Stream>();
    startedAt = Date.now();
    readonly duty: number;
    private readonly dataDir: string;
    private readonly bases: Map<number, number>;
    private readonly log: (msg: string) => void;
    private running = false;
    private stopped: Promise<void> | null = null;
    private checkpointing: Promise<void> | null = null;
    private lastCheckpoint = 0;
    private checkpointEvery = MIN_CHECKPOINT_MS;
    private scratch = new Uint8Array(1 << 14);

    constructor(options: CalculatorOptions) {
        this.dataDir = options.dataDir;
        this.duty = options.duty;
        this.bases = options.bases;
        this.log = options.log ?? (() => undefined);
    }

    private path(name: string): string {
        return join(this.dataDir, name);
    }

    /** Carga lo guardado (o empieza de cero) para cada base. */
    async load(): Promise<void> {
        await mkdir(this.dataDir, { recursive: true });
        try {
            const meta = JSON.parse(
                await readFile(this.path('meta.json'), 'utf8'),
            ) as Meta;
            this.startedAt = meta.startedAt;
        } catch {
            await this.writeAtomic(
                'meta.json',
                JSON.stringify({
                    startedAt: this.startedAt,
                } satisfies Meta),
            );
        }

        for (const [base, weight] of this.bases) {
            const stream =
                (await this.loadStream(base, weight)) ??
                this.freshStream(base, weight);
            this.streams.set(base, stream);
            this.log(
                `base ${base}: ${stream.length} dígitos${stream.length ? ' recuperados' : ' (desde cero)'}`,
            );
        }
    }

    private freshStream(base: number, weight: number): Stream {
        const spigot = new PiSpigot(base);
        const integerPart = spigot.next();
        return new Stream(base, weight, spigot, integerPart);
    }

    private async loadStream(
        base: number,
        weight: number,
    ): Promise<Stream | null> {
        let state: SavedState;
        try {
            state = JSON.parse(
                await readFile(
                    this.path(`state-${base}.json`),
                    'utf8',
                ),
            ) as SavedState;
        } catch {
            return null;
        }
        if (state.format !== 1 || state.base !== base) return null;
        const file = this.path(`digits-${base}.bin`);
        const bytes = new Uint8Array(await readFile(file));
        if (bytes.length < state.produced) {
            this.log(
                `base ${base}: faltan dígitos en disco (${bytes.length} < ${state.produced}); se empieza de cero`,
            );
            await rename(file, `${file}.roto-${Date.now()}`).catch(
                () => undefined,
            );
            return null;
        }
        if (bytes.length > state.produced)
            await truncate(file, state.produced);
        const stream = new Stream(
            base,
            weight,
            PiSpigot.restore(state.spigot),
            state.integerPart,
            bytes.subarray(0, state.produced),
        );
        stream.elapsedMs = state.elapsedMs;
        stream.cpuMs = state.cpuMs;
        return stream;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.stopped = this.loop();
    }

    /** Detiene el cálculo y guarda (para SIGTERM en un redespliegue). */
    async stop(): Promise<void> {
        this.running = false;
        await this.stopped;
        await this.checkpoint();
    }

    /** La base que menos CPU ha recibido en proporción a su peso. */
    private pick(): Stream {
        let best: Stream | null = null;
        for (const s of this.streams.values()) {
            if (
                !best ||
                s.cpuMs / s.weight < best.cpuMs / best.weight
            )
                best = s;
        }
        if (!best) throw new Error('Sin bases que calcular');
        return best;
    }

    private async loop(): Promise<void> {
        let last = performance.now();
        this.lastCheckpoint = last;
        while (this.running) {
            const stream = this.pick();
            const t0 = performance.now();
            let n = 0;
            do {
                if (n === this.scratch.length) {
                    const bigger = new Uint8Array(
                        this.scratch.length * 2,
                    );
                    bigger.set(this.scratch);
                    this.scratch = bigger;
                }
                this.scratch[n++] = stream.spigot.next();
            } while (performance.now() - t0 < SLICE_MS);
            const work = performance.now() - t0;
            stream.cpuMs += work;

            const now = performance.now();
            for (const s of this.streams.values())
                s.elapsedMs += now - last;
            last = now;
            stream.append(this.scratch.slice(0, n));

            if (
                now - this.lastCheckpoint >= this.checkpointEvery &&
                !this.checkpointing
            ) {
                this.lastCheckpoint = now;
                void this.checkpoint();
            }

            // Descanso proporcional para usar solo `duty` de una CPU.
            const rest = (work * (1 - this.duty)) / this.duty;
            await sleep(Math.max(1, rest));
        }
    }

    /** Guarda los dígitos nuevos y el estado de cada base. */
    async checkpoint(): Promise<void> {
        if (this.checkpointing) {
            await this.checkpointing;
        }
        this.checkpointing = this.doCheckpoint().finally(() => {
            this.checkpointing = null;
        });
        await this.checkpointing;
    }

    private async doCheckpoint(): Promise<void> {
        const t0 = performance.now();
        // Se captura todo de forma síncrona: estado y dígitos coherentes.
        const jobs = [...this.streams.values()]
            .filter((s) => s.length > s.persisted)
            .map((s) => ({
                stream: s,
                bytes: s.view(s.persisted, s.length).slice(),
                state: {
                    format: 1,
                    base: s.base,
                    produced: s.length,
                    integerPart: s.integerPart,
                    elapsedMs: s.elapsedMs,
                    cpuMs: s.cpuMs,
                    spigot: s.spigot.snapshot(),
                    savedAt: Date.now(),
                } satisfies SavedState,
            }));
        for (const job of jobs) {
            try {
                const fh = await open(
                    this.path(`digits-${job.stream.base}.bin`),
                    'a',
                );
                try {
                    await fh.write(job.bytes);
                    await fh.sync();
                } finally {
                    await fh.close();
                }
                await this.writeAtomic(
                    `state-${job.stream.base}.json`,
                    JSON.stringify(job.state),
                );
                job.stream.persisted = job.state.produced;
            } catch (error) {
                this.log(
                    `no se pudo guardar la base ${job.stream.base}: ${String(error)}`,
                );
            }
        }
        // Si guardar tarda (el estado crece con los dígitos), se espacia.
        const took = performance.now() - t0;
        this.checkpointEvery = Math.max(MIN_CHECKPOINT_MS, took * 40);
    }

    private async writeAtomic(
        name: string,
        content: string,
    ): Promise<void> {
        const tmp = this.path(`${name}.tmp`);
        await writeFile(tmp, content);
        await rename(tmp, this.path(name));
    }
}
