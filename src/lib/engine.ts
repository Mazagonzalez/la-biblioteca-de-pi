import type { FromWorker, ToWorker } from './protocol';
import { RemoteSource, type GlobalInfo } from './remote';
import { SymbolStats, type RunRecord } from './stats';
import { DigitStore } from './store';

/** Velocidad (dígitos/s de cálculo) en una ventana deslizante. */
export class SpeedMeter {
    private samples: { ms: number; count: number }[] = [
        { ms: 0, count: 0 },
    ];
    private lastHistoryMs = 0;
    rate = 0;
    /** Una muestra de velocidad por segundo de cálculo (máx. 120). */
    readonly history: number[] = [];

    /** Empieza a medir desde aquí (p. ej. tras retomar lo guardado). */
    reset(computeMs: number, count: number): void {
        this.samples = [{ ms: computeMs, count }];
        this.lastHistoryMs = computeMs;
        this.rate = 0;
    }

    add(computeMs: number, count: number): void {
        const samples = this.samples;
        samples.push({ ms: computeMs, count });
        while (
            samples.length > 2 &&
            computeMs - samples[1].ms > 3000
        ) {
            samples.shift();
        }
        const first = samples[0];
        const dt = computeMs - first.ms;
        if (dt > 0) this.rate = ((count - first.count) / dt) * 1000;
        if (computeMs - this.lastHistoryMs >= 1000) {
            this.lastHistoryMs = computeMs;
            this.history.push(this.rate);
            if (this.history.length > 120) this.history.shift();
        }
    }
}

/** Todo lo que el hilo principal sabe de un flujo de una base. */
export class PiStream {
    readonly base: number;
    readonly store = new DigitStore();
    readonly stats: SymbolStats;
    readonly speed = new SpeedMeter();
    integerPart = 3;
    computeMs = 0;

    constructor(base: number) {
        this.base = base;
        this.stats = new SymbolStats(base);
    }

    get length(): number {
        return this.store.length;
    }
}

type BatchListener = (stream: PiStream, added: number) => void;
type RecordListener = (stream: PiStream, record: RunRecord) => void;
type StateListener = (engine: PiEngine) => void;
type RestoreListener = (stream: PiStream) => void;

export interface EngineOptions {
    /** URL del servidor global; sin ella se calcula en el navegador. */
    server?: string;
}

/**
 * Recibe los dígitos (del worker local o del servidor global), los guarda
 * por base, actualiza las estadísticas y avisa a la interfaz.
 */
export class PiEngine {
    private source: { send(msg: ToWorker): void };
    private remote: RemoteSource | null = null;
    private readonly streams = new Map<number, PiStream>();
    private readonly batchListeners = new Set<BatchListener>();
    private readonly recordListeners = new Set<RecordListener>();
    private readonly stateListeners = new Set<StateListener>();
    private readonly restoreListeners = new Set<RestoreListener>();
    activeBase: number;
    paused = false;
    /** null mientras no se sabe; luego, si IndexedDB funciona aquí. */
    storage: boolean | null = null;
    /** Datos del cálculo global, o null si se calcula en el navegador. */
    global: GlobalInfo | null = null;
    /** Se quiso usar el servidor global pero no respondió. */
    fellBack = false;

    constructor(base: number, options: EngineOptions = {}) {
        this.activeBase = base;
        if (options.server) {
            this.remote = new RemoteSource(options.server, (msg) =>
                this.receive(msg),
            );
            this.source = this.remote;
            this.send({ type: 'setBase', base });
        } else {
            this.source = this.startLocal();
        }

        // Guarda el progreso al ocultar o cerrar la página.
        const flush = () => this.send({ type: 'flush' });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
        window.addEventListener('pagehide', flush);
    }

    /** Borra lo guardado en este navegador y recarga la página. */
    reset(): void {
        this.send({ type: 'reset' });
    }

    onRestore(fn: RestoreListener): () => void {
        this.restoreListeners.add(fn);
        return () => this.restoreListeners.delete(fn);
    }

    stream(base: number): PiStream {
        let stream = this.streams.get(base);
        if (!stream) {
            stream = new PiStream(base);
            this.streams.set(base, stream);
        }
        return stream;
    }

    get active(): PiStream {
        return this.stream(this.activeBase);
    }

    setBase(base: number): void {
        if (base === this.activeBase) return;
        this.activeBase = base;
        this.send({ type: 'setBase', base });
        this.emitState();
    }

    pause(): void {
        if (this.paused) return;
        this.paused = true;
        this.send({ type: 'pause' });
        this.emitState();
    }

    resume(): void {
        if (!this.paused) return;
        this.paused = false;
        this.send({ type: 'resume' });
        this.emitState();
    }

    toggle(): void {
        if (this.paused) this.resume();
        else this.pause();
    }

    onBatch(fn: BatchListener): () => void {
        this.batchListeners.add(fn);
        return () => this.batchListeners.delete(fn);
    }

    onRecord(fn: RecordListener): () => void {
        this.recordListeners.add(fn);
        return () => this.recordListeners.delete(fn);
    }

    onState(fn: StateListener): () => void {
        this.stateListeners.add(fn);
        return () => this.stateListeners.delete(fn);
    }

    private send(msg: ToWorker): void {
        this.source.send(msg);
    }

    /** Arranca el cálculo en este navegador (worker + IndexedDB). */
    private startLocal(): { send(msg: ToWorker): void } {
        const worker = new Worker(
            new URL('../workers/pi.worker.ts', import.meta.url),
            { type: 'module' },
        );
        worker.onmessage = (event: MessageEvent<FromWorker>) =>
            this.receive(event.data);
        const source = {
            send: (msg: ToWorker) => worker.postMessage(msg),
        };
        source.send({ type: 'setBase', base: this.activeBase });
        if (this.paused) source.send({ type: 'pause' });
        return source;
    }

    private emitState(): void {
        for (const fn of this.stateListeners) fn(this);
    }

    private receive(msg: FromWorker): void {
        if (msg.type === 'reset-done') {
            location.reload();
            return;
        }
        if (msg.type === 'global') {
            this.global = {
                startedAt: msg.startedAt,
                duty: msg.duty,
            };
            this.emitState();
            return;
        }
        if (msg.type === 'unavailable') {
            this.remote?.dispose();
            this.remote = null;
            this.global = null;
            this.fellBack = true;
            this.source = this.startLocal();
            this.emitState();
            return;
        }
        if (msg.type === 'storage') {
            this.storage = msg.available;
            this.emitState();
            return;
        }
        const stream = this.stream(msg.base);
        // Los lotes llegan en orden; si no encaja, se descarta.
        if (msg.start !== stream.length) return;
        stream.integerPart = msg.integerPart;
        stream.computeMs = msg.computeMs;
        stream.store.append(msg.digits);
        const record = stream.stats.push(msg.digits, msg.start);
        if (msg.restored) {
            stream.speed.reset(msg.computeMs, stream.length);
        } else {
            stream.speed.add(msg.computeMs, stream.length);
        }
        for (const fn of this.batchListeners)
            fn(stream, msg.digits.length);
        if (msg.restored) {
            for (const fn of this.restoreListeners) fn(stream);
        } else if (record) {
            for (const fn of this.recordListeners) fn(stream, record);
        }
    }
}
