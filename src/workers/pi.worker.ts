/**
 * Worker de cálculo: un spigot por base. Solo avanza el flujo activo;
 * los demás quedan congelados con su estado intacto.
 *
 * Calcula durante ~BATCH_MS y envía el lote como Uint8Array transferible,
 * luego cede el turno (vía MessageChannel, sin el mínimo de 4 ms de
 * setTimeout) para atender pausas o cambios de base.
 */
import type { BatchMessage, ToWorker } from '../lib/protocol';
import { PiSpigot } from '../lib/spigot';

const BATCH_MS = 40;

interface Stream {
    spigot: PiSpigot;
    integerPart: number;
    produced: number;
    computeMs: number;
}

const streams = new Map<number, Stream>();
let active: Stream | null = null;
let running = true;
let scheduled = false;
let scratch = new Uint8Array(4096);

const tick = new MessageChannel();
tick.port1.onmessage = step;

function schedule(): void {
    if (scheduled || !running || !active) return;
    scheduled = true;
    tick.port2.postMessage(null);
}

function streamFor(base: number): Stream {
    let stream = streams.get(base);
    if (!stream) {
        const spigot = new PiSpigot(base);
        const t0 = performance.now();
        const integerPart = spigot.next();
        stream = {
            spigot,
            integerPart,
            produced: 0,
            computeMs: performance.now() - t0,
        };
        streams.set(base, stream);
    }
    return stream;
}

function step(): void {
    scheduled = false;
    const stream = active;
    if (!running || !stream) return;

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
    const message: BatchMessage = {
        type: 'batch',
        base: stream.spigot.base,
        start: stream.produced,
        digits,
        integerPart: stream.integerPart,
        computeMs: stream.computeMs,
    };
    stream.produced += n;
    self.postMessage(message, { transfer: [digits.buffer] });
    schedule();
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
    const msg = event.data;
    switch (msg.type) {
        case 'setBase':
            active = streamFor(msg.base);
            break;
        case 'pause':
            running = false;
            break;
        case 'resume':
            running = true;
            break;
    }
    schedule();
};
