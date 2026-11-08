/**
 * Fuente remota: en lugar de calcular en el navegador, recibe los dígitos
 * del servidor global (el mismo π para todos los visitantes).
 *
 * Habla el mismo protocolo que el worker (ToWorker / FromWorker), así el
 * motor no distingue de dónde vienen los dígitos:
 *  1. Descarga de una vez todo lo calculado (comprimido).
 *  2. Se suscribe por SSE a los lotes nuevos desde ese punto.
 * Solo mantiene abierta la conexión de la base activa; al volver a otra,
 * pide lo que se perdió desde donde se quedó.
 */
import type { FromWorker, ToWorker } from './protocol';

const RECONNECT_MS = 3000;

export interface GlobalInfo {
    startedAt: number;
    duty: number;
}

function decodeBase64(text: string): Uint8Array {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export class RemoteSource {
    private readonly url: string;
    private readonly emit: (msg: FromWorker) => void;
    private readonly ready: Promise<boolean>;
    private readonly received = new Map<number, number>();
    private loading = new Map<number, Promise<boolean>>();
    private events: EventSource | null = null;
    private retry = 0;
    private active = -1;
    private paused = false;

    constructor(url: string, emit: (msg: FromWorker) => void) {
        this.url = url.replace(/\/+$/, '');
        this.emit = emit;
        this.ready = this.connect();
    }

    private async connect(): Promise<boolean> {
        try {
            const res = await fetch(`${this.url}/api/info`, {
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(String(res.status));
            const info = (await res.json()) as GlobalInfo;
            this.emit({
                type: 'global',
                startedAt: info.startedAt,
                duty: info.duty,
            });
            return true;
        } catch {
            this.emit({ type: 'unavailable' });
            return false;
        }
    }

    send(msg: ToWorker): void {
        switch (msg.type) {
            case 'setBase':
                void this.activate(msg.base);
                return;
            case 'pause':
                this.paused = true;
                this.close();
                return;
            case 'resume':
                this.paused = false;
                if (this.active >= 0) void this.activate(this.active);
                return;
            // El progreso global vive en el servidor: nada que guardar ni borrar.
            case 'flush':
            case 'reset':
                return;
        }
    }

    dispose(): void {
        this.close();
        this.active = -1;
    }

    private async activate(base: number): Promise<void> {
        this.active = base;
        this.close();
        if (!(await this.ready)) return;
        if (!(await this.load(base))) return;
        if (this.active === base && !this.paused) this.open(base);
    }

    /** Descarga todo lo calculado de esa base (una vez por visita). */
    private load(base: number): Promise<boolean> {
        if (this.received.has(base)) return Promise.resolve(true);
        let pending = this.loading.get(base);
        if (!pending) {
            pending = this.download(base).finally(() =>
                this.loading.delete(base),
            );
            this.loading.set(base, pending);
        }
        return pending;
    }

    private async download(base: number): Promise<boolean> {
        try {
            const res = await fetch(
                `${this.url}/api/digits/${base}`,
                {
                    cache: 'no-store',
                },
            );
            if (!res.ok) throw new Error(String(res.status));
            const digits = new Uint8Array(await res.arrayBuffer());
            this.received.set(base, digits.length);
            this.emit({
                type: 'batch',
                base,
                start: 0,
                digits,
                integerPart: Number(
                    res.headers.get('X-Integer-Part') ?? 3,
                ),
                computeMs: Number(
                    res.headers.get('X-Elapsed-Ms') ?? 0,
                ),
                restored: true,
            });
            return true;
        } catch {
            return false;
        }
    }

    private open(base: number): void {
        this.close();
        const from = this.received.get(base) ?? 0;
        const events = new EventSource(
            `${this.url}/api/stream/${base}?from=${from}`,
        );
        this.events = events;
        events.addEventListener('batch', (e) => {
            const msg = JSON.parse(
                (e as MessageEvent<string>).data,
            ) as {
                start: number;
                elapsedMs: number;
                d: string;
            };
            const have = this.received.get(base) ?? 0;
            let digits = decodeBase64(msg.d);
            let start = msg.start;
            // Recorta lo que ya teníamos; si hay un hueco, se descarta.
            if (start < have) {
                digits = digits.subarray(have - start);
                start = have;
            }
            if (start !== have || digits.length === 0) return;
            this.received.set(base, have + digits.length);
            this.retry = 0;
            this.emit({
                type: 'batch',
                base,
                start,
                digits,
                integerPart: 3,
                computeMs: msg.elapsedMs,
            });
        });
        events.onerror = () => {
            // Se reabre a mano para pedir desde lo último recibido.
            events.close();
            if (this.events !== events) return;
            this.events = null;
            const wait = Math.min(
                30_000,
                RECONNECT_MS * 2 ** this.retry++,
            );
            window.setTimeout(() => {
                if (
                    this.active === base &&
                    !this.paused &&
                    !this.events
                ) {
                    this.open(base);
                }
            }, wait);
        };
    }

    private close(): void {
        this.events?.close();
        this.events = null;
    }
}
