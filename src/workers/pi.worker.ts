/**
 * Worker de cálculo: un spigot por base. Solo avanza el flujo activo;
 * los demás quedan congelados con su estado intacto.
 *
 * Calcula durante ~BATCH_MS y envía el lote como Uint8Array transferible,
 * luego cede el turno (vía MessageChannel, sin el mínimo de 4 ms de
 * setTimeout) para atender pausas o cambios de base.
 *
 * El progreso se guarda en IndexedDB cada SAVE_EVERY_MS de cálculo (y al
 * pausar, cambiar de base u ocultar la página), así que al recargar se
 * retoma donde quedó.
 */
import {
    CHUNK,
    FORMAT,
    clearAll,
    loadStream,
    openDb,
    saveStream,
    type ChunkWrite,
} from '../lib/persist';
import type {
    BatchMessage,
    FromWorker,
    ToWorker,
} from '../lib/protocol';
import { PiSpigot } from '../lib/spigot';

const BATCH_MS = 40;
const SAVE_EVERY_MS = 5000;

interface Stream {
    spigot: PiSpigot;
    integerPart: number;
    produced: number;
    computeMs: number;
    /** Trozo en curso (aún no lleno) y su índice. */
    chunk: Uint8Array;
    chunkIndex: number;
    /** Trozos que se llenaron desde el último guardado. */
    full: ChunkWrite[];
    /** Hay dígitos sin guardar. */
    dirty: boolean;
    savedAtMs: number;
    saving: Promise<void> | null;
}

const streams = new Map<number, Stream>();
const loading = new Map<number, Promise<Stream>>();
let active: Stream | null = null;
let wanted = -1;
let running = true;
let stopped = false;
let scheduled = false;
let scratch = new Uint8Array(4096);
const db = openDb();

function post(msg: FromWorker, transfer: Transferable[] = []): void {
    self.postMessage(msg, { transfer });
}

void db.then((d) => post({ type: 'storage', available: d !== null }));

const tick = new MessageChannel();
tick.port1.onmessage = step;

function schedule(): void {
    if (scheduled || !running || stopped || !active) return;
    scheduled = true;
    tick.port2.postMessage(null);
}

function fresh(base: number): Stream {
    const spigot = new PiSpigot(base);
    const t0 = performance.now();
    const integerPart = spigot.next();
    return {
        spigot,
        integerPart,
        produced: 0,
        computeMs: performance.now() - t0,
        chunk: new Uint8Array(CHUNK),
        chunkIndex: 0,
        full: [],
        dirty: false,
        savedAtMs: 0,
        saving: null,
    };
}

/** Crea el flujo, o lo reconstruye desde IndexedDB y envía lo guardado. */
async function load(base: number): Promise<Stream> {
    const d = await db;
    if (d) {
        try {
            const saved = await loadStream(d, base);
            if (saved) {
                const { state, digits } = saved;
                const chunkIndex = Math.floor(state.produced / CHUNK);
                const chunk = new Uint8Array(CHUNK);
                chunk.set(digits.subarray(chunkIndex * CHUNK));
                const stream: Stream = {
                    spigot: PiSpigot.restore(state.spigot),
                    integerPart: state.integerPart,
                    produced: state.produced,
                    computeMs: state.computeMs,
                    chunk,
                    chunkIndex,
                    full: [],
                    dirty: false,
                    savedAtMs: state.computeMs,
                    saving: null,
                };
                const message: BatchMessage = {
                    type: 'batch',
                    base,
                    start: 0,
                    digits,
                    integerPart: state.integerPart,
                    computeMs: state.computeMs,
                    restored: true,
                };
                post(message, [digits.buffer]);
                return stream;
            }
        } catch {
            // Datos dañados o incompatibles: se empieza de cero.
        }
    }
    return fresh(base);
}

function streamFor(base: number): Promise<Stream> {
    const ready = streams.get(base);
    if (ready) return Promise.resolve(ready);
    let pending = loading.get(base);
    if (!pending) {
        pending = load(base).then((stream) => {
            streams.set(base, stream);
            loading.delete(base);
            return stream;
        });
        loading.set(base, pending);
    }
    return pending;
}

/** Copia los dígitos nuevos en los trozos que se guardarán. */
function record(stream: Stream, digits: Uint8Array): void {
    let i = 0;
    while (i < digits.length) {
        const fill = stream.produced + i - stream.chunkIndex * CHUNK;
        const n = Math.min(CHUNK - fill, digits.length - i);
        stream.chunk.set(digits.subarray(i, i + n), fill);
        i += n;
        if (fill + n === CHUNK) {
            stream.full.push({
                index: stream.chunkIndex,
                data: stream.chunk,
            });
            stream.chunk = new Uint8Array(CHUNK);
            stream.chunkIndex++;
        }
    }
    stream.dirty = true;
}

async function save(stream: Stream): Promise<void> {
    if (!stream.dirty || stopped) return;
    if (stream.saving) await stream.saving;
    const d = await db;
    if (!d || !stream.dirty || stopped) return;

    const fill = stream.produced - stream.chunkIndex * CHUNK;
    const chunks = stream.full.splice(0);
    if (fill > 0) {
        chunks.push({
            index: stream.chunkIndex,
            data: stream.chunk.slice(0, fill),
        });
    }
    stream.dirty = false;
    stream.savedAtMs = stream.computeMs;
    stream.saving = saveStream(
        d,
        {
            format: FORMAT,
            base: stream.spigot.base,
            produced: stream.produced,
            computeMs: stream.computeMs,
            integerPart: stream.integerPart,
            spigot: stream.spigot.snapshot(),
            savedAt: Date.now(),
        },
        chunks,
    )
        .catch(() => {
            // Sin espacio o sin permiso: se reintenta en el próximo guardado.
            stream.full.unshift(
                ...chunks.filter((c) => c.data.length === CHUNK),
            );
            stream.dirty = true;
        })
        .finally(() => {
            stream.saving = null;
        });
    await stream.saving;
}

function saveAll(): void {
    for (const stream of streams.values()) void save(stream);
}

function step(): void {
    scheduled = false;
    const stream = active;
    if (!running || stopped || !stream) return;

    const t0 = performance.now();
    let n = 0;
    do {
        if (n === scratch.length) {
            const bigger = new Uint8Array(scratch.length * 2);
            bigger.set(scratch);
            scratch = bigger;
        }
        scratch[n++] = stream.spigot.next();
    } while (performance.now() - t0 < BATCH_MS);
    stream.computeMs += performance.now() - t0;

    const digits = scratch.slice(0, n);
    record(stream, digits);
    const message: BatchMessage = {
        type: 'batch',
        base: stream.spigot.base,
        start: stream.produced,
        digits,
        integerPart: stream.integerPart,
        computeMs: stream.computeMs,
    };
    stream.produced += n;
    post(message, [digits.buffer]);

    if (stream.computeMs - stream.savedAtMs >= SAVE_EVERY_MS) {
        void save(stream);
    }
    schedule();
}

async function activate(base: number): Promise<void> {
    wanted = base;
    if (active && active.spigot.base !== base) void save(active);
    const stream = await streamFor(base);
    // Mientras cargaba pudo llegar otra petición.
    if (wanted !== base) return;
    active = stream;
    schedule();
}

async function reset(): Promise<void> {
    stopped = true;
    active = null;
    for (const s of streams.values()) {
        if (s.saving) await s.saving.catch(() => undefined);
    }
    const d = await db;
    if (d) await clearAll(d).catch(() => undefined);
    post({ type: 'reset-done' });
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
    const msg = event.data;
    switch (msg.type) {
        case 'setBase':
            void activate(msg.base);
            return;
        case 'pause':
            running = false;
            saveAll();
            return;
        case 'resume':
            running = true;
            schedule();
            return;
        case 'flush':
            saveAll();
            return;
        case 'reset':
            void reset();
            return;
    }
};
