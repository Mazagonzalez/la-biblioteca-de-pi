/**
 * Sintetizador de π: cada dígito 0–9 es una nota de la escala pentatónica
 * mayor de Do en dos octavas. Usa el patrón de planificación con
 * anticipación de Web Audio: un temporizador revisa cada 25 ms y programa
 * en el reloj del audio las notas de los próximos ~150 ms, así el ritmo es
 * exacto aunque el hilo principal esté ocupado.
 *
 * La reproducción consume su propio cursor sobre los dígitos ya
 * calculados, independiente de la velocidad de cálculo.
 */

/** Do4 Re4 Mi4 Sol4 La4 Do5 Re5 Mi5 Sol5 La5 */
export const PENTATONIC = [
    261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25,
    783.99, 880.0,
];

const LOOKAHEAD = 0.15;
const TICK_MS = 25;

export interface NoteEvent {
    index: number;
    digit: number;
    time: number;
}

export interface DigitSource {
    readonly length: number;
    at(index: number): number;
}

export class PiSynth {
    /** Índice del próximo dígito que sonará. */
    cursor = 0;
    tempo = 4;
    volume = 0.6;
    playing = false;
    /** Se llama cuando el sintetizador alcanza a los dígitos calculados. */
    onStarve: ((starving: boolean) => void) | null = null;

    private ctx: AudioContext | null = null;
    private master: GainNode | null = null;
    private dry: GainNode | null = null;
    private wet: GainNode | null = null;
    private timer = 0;
    private nextTime = 0;
    private starving = false;
    private readonly queue: NoteEvent[] = [];
    private source: DigitSource | null = null;

    setSource(source: DigitSource): void {
        this.source = source;
    }

    /** Debe llamarse desde un gesto (clic): el navegador lo exige. */
    async start(): Promise<void> {
        const ctx = this.ensureContext();
        if (ctx.state !== 'running') await ctx.resume();
        if (this.playing) return;
        this.playing = true;
        this.nextTime = ctx.currentTime + 0.06;
        this.timer = window.setInterval(
            () => this.schedule(),
            TICK_MS,
        );
        this.schedule();
    }

    stop(): void {
        if (!this.playing) return;
        this.playing = false;
        clearInterval(this.timer);
        // Las notas ya programadas que no han sonado se devuelven al cursor.
        const now = this.ctx?.currentTime ?? 0;
        const pending = this.queue.filter((e) => e.time > now);
        if (pending.length) this.cursor = pending[0].index;
        this.queue.length = 0;
        if (this.master && this.ctx) {
            const g = this.master.gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(0, now + 0.08);
            g.setValueAtTime(0, now + 0.09);
            g.linearRampToValueAtTime(
                this.gainFor(this.volume),
                now + 0.2,
            );
        }
    }

    setVolume(volume: number): void {
        this.volume = volume;
        if (this.master && this.ctx) {
            this.master.gain.setTargetAtTime(
                this.gainFor(volume),
                this.ctx.currentTime,
                0.05,
            );
        }
    }

    setTempo(notesPerSecond: number): void {
        this.tempo = notesPerSecond;
    }

    /** Nota que suena ahora mismo (la última cuyo inicio ya pasó). */
    current(): NoteEvent | null {
        if (!this.ctx) return null;
        const now = this.ctx.currentTime;
        let current: NoteEvent | null = null;
        while (this.queue.length && this.queue[0].time <= now) {
            current = this.queue.shift() ?? null;
        }
        return current;
    }

    private gainFor(volume: number): number {
        // Curva perceptual aproximada.
        return volume * volume * 0.5;
    }

    private ensureContext(): AudioContext {
        if (this.ctx) return this.ctx;
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        const master = ctx.createGain();
        master.gain.value = this.gainFor(this.volume);
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.ratio.value = 3;
        master.connect(compressor).connect(ctx.destination);

        const dry = ctx.createGain();
        dry.gain.value = 0.82;
        dry.connect(master);
        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(ctx, 2.6);
        const wet = ctx.createGain();
        wet.gain.value = 0.32;
        wet.connect(reverb).connect(master);

        this.ctx = ctx;
        this.master = master;
        this.dry = dry;
        this.wet = wet;
        return ctx;
    }

    private schedule(): void {
        const ctx = this.ctx;
        const source = this.source;
        if (!ctx || !source || !this.playing) return;
        const horizon = ctx.currentTime + LOOKAHEAD;
        if (this.nextTime < ctx.currentTime)
            this.nextTime = ctx.currentTime + 0.02;
        while (this.nextTime < horizon) {
            if (this.cursor >= source.length) {
                this.setStarving(true);
                this.nextTime = ctx.currentTime + 0.05;
                return;
            }
            this.setStarving(false);
            const digit = source.at(this.cursor);
            this.voice(PENTATONIC[digit], this.nextTime);
            this.queue.push({
                index: this.cursor,
                digit,
                time: this.nextTime,
            });
            this.cursor++;
            this.nextTime += 1 / this.tempo;
        }
    }

    private setStarving(starving: boolean): void {
        if (this.starving === starving) return;
        this.starving = starving;
        this.onStarve?.(starving);
    }

    /** Una nota tipo campana suave: triángulo + sinusoide una octava arriba. */
    private voice(freq: number, when: number): void {
        const ctx = this.ctx;
        if (!ctx || !this.dry || !this.wet) return;
        const length = Math.min(
            1.6,
            Math.max(0.35, 2.2 / this.tempo),
        );

        const env = ctx.createGain();
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(0.5, when + 0.012);
        env.gain.exponentialRampToValueAtTime(0.18, when + 0.12);
        env.gain.exponentialRampToValueAtTime(0.0001, when + length);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(freq * 6, when);
        filter.frequency.exponentialRampToValueAtTime(
            freq * 1.5,
            when + length,
        );
        filter.Q.value = 0.4;

        const body = ctx.createOscillator();
        body.type = 'triangle';
        body.frequency.value = freq;
        const shimmer = ctx.createOscillator();
        shimmer.type = 'sine';
        shimmer.frequency.value = freq * 2;
        const shimmerGain = ctx.createGain();
        shimmerGain.gain.value = 0.18;

        body.connect(filter);
        shimmer.connect(shimmerGain).connect(filter);
        filter.connect(env);
        env.connect(this.dry);
        env.connect(this.wet);

        body.start(when);
        shimmer.start(when);
        body.stop(when + length + 0.05);
        shimmer.stop(when + length + 0.05);
    }
}

/** Respuesta al impulso sintética: ruido estéreo con caída exponencial. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const t = i / length;
            data[i] = (Math.random() * 2 - 1) * (1 - t) ** 3.2;
        }
    }
    return buffer;
}
