import { arcEnd, arcStart, fitRadius, threadAngle } from '../drawing';
import type { PiStream } from '../engine';
import { DIGIT_PALETTE } from '../palette';
import { boxesWithin } from './obstacles';

/** Tramos de antigüedad: los hilos viejos se apagan poco a poco. */
const AGE_BUCKETS = 10;

/** La paleta de los dígitos, aclarada para brillar sobre fondo negro. */
const THREAD_COLORS = DIGIT_PALETTE.map((hex, d) =>
    mixWithWhite(hex, d === 0 ? 0.4 : 0.15),
);

function mixWithWhite(hex: string, amount: number): string {
    const c = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16);
        return Math.round(v + (255 - v) * amount);
    });
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

function ageAlpha(bucket: number): number {
    // bucket 0 = lo más viejo, AGE_BUCKETS − 1 = lo más nuevo.
    const t = (bucket + 1) / AGE_BUCKETS;
    return 0.025 + 0.42 * t ** 2.4;
}

export interface ThreadsInfo {
    /** Hilos dibujados ahora. */
    shown: number;
    /** Último par: de qué dígito a cuál (null si aún no hay). */
    from: number | null;
    to: number | null;
}

/**
 * Hilos: cada dígito de π se une con el siguiente por un hilo que cruza el
 * círculo. Se dibujan los últimos `window` hilos; los más nuevos brillan y
 * los viejos se desvanecen.
 */
export class ThreadsCanvas {
    readonly root: HTMLElement;
    onInfo: ((info: ThreadsInfo) => void) | null = null;
    /** Elementos encima del dibujo que el círculo no debe pisar. */
    avoid: HTMLElement[] = [];

    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private stream: PiStream | null = null;
    private window = 5000;
    private digits = new Uint8Array(0);
    private width = 0;
    private height = 0;
    private dpr = 1;
    private radius = 40;
    private font = 'monospace';
    private frame = 0;
    private timer = 0;
    private lastRender = 0;
    private active = false;
    /** Longitud del flujo la última vez que se dibujó. */
    private drawnLength = -1;

    constructor(root: HTMLElement) {
        this.root = root;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'draw-canvas';
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D no disponible');
        this.ctx = ctx;
        root.append(this.canvas);
        new ResizeObserver(() => {
            this.resize();
            this.drawnLength = -1;
            this.invalidate();
        }).observe(root);
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        this.active = true;
        this.drawnLength = -1;
        this.invalidate();
    }

    pause(): void {
        this.active = false;
    }

    setWindow(threads: number): void {
        this.window = threads;
        this.drawnLength = -1;
        this.invalidate();
    }

    invalidate(): void {
        if (this.frame || this.timer || !this.active) return;
        // Con muchos hilos cada dibujo cuesta más: se espacian un poco.
        const gap = this.window > 8000 ? 120 : 40;
        const wait = this.lastRender + gap - performance.now();
        if (wait > 0) {
            this.timer = window.setTimeout(() => {
                this.timer = 0;
                this.invalidate();
            }, wait);
            return;
        }
        this.frame = requestAnimationFrame(() => this.render());
    }

    private resize(): void {
        const rect = this.root.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.radius = fitRadius(
            this.width,
            this.height,
            46,
            boxesWithin(this.root, this.avoid),
            40,
        );
        this.font =
            getComputedStyle(this.root)
                .getPropertyValue('--font-mono')
                .trim() || 'monospace';
    }

    private render(): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream || !this.active) return;
        if (this.width <= 1) this.resize();
        if (this.width <= 1) return;
        const n = stream.length;
        if (n === this.drawnLength) return;
        this.drawnLength = n;
        this.lastRender = performance.now();

        // Últimos `window` hilos: hilo i une el dígito i con el i + 1.
        const count = Math.max(0, Math.min(this.window, n - 1));
        const first = n - 1 - count;
        if (this.digits.length < count + 1)
            this.digits = new Uint8Array(
                Math.max(count + 1, this.digits.length * 2),
            );
        const digits = this.digits;
        if (count > 0) stream.store.read(first, n, digits);

        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;
        const cx = w / 2;
        const cy = h / 2;
        const R = this.radius;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        // Hilos agrupados por (antigüedad, color): pocos trazos grandes.
        const paths = Array.from(
            { length: AGE_BUCKETS * 10 },
            () => new Path2D(),
        );
        const pull = 0.3;
        for (let k = 0; k < count; k++) {
            const i = first + k;
            const a = digits[k];
            const b = digits[k + 1];
            const t0 = threadAngle(a, i);
            const t1 = threadAngle(b, i + 1);
            const x0 = cx + R * Math.cos(t0);
            const y0 = cy + R * Math.sin(t0);
            const x1 = cx + R * Math.cos(t1);
            const y1 = cy + R * Math.sin(t1);
            const qx = cx + ((x0 + x1) / 2 - cx) * pull;
            const qy = cy + ((y0 + y1) / 2 - cy) * pull;
            const bucket = Math.min(
                AGE_BUCKETS - 1,
                Math.floor(((k + 1) / count) * AGE_BUCKETS),
            );
            const path = paths[bucket * 10 + a];
            path.moveTo(x0, y0);
            path.quadraticCurveTo(qx, qy, x1, y1);
        }

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = count > 8000 ? 0.6 : 0.85;
        // Tinta por área: muchos hilos en un círculo chico se queman a
        // blanco, así que se aclaran en proporción (6 se ve bien).
        const ink = (count * ctx.lineWidth) / (Math.PI * R);
        const gain = Math.min(1.4, 6 / Math.max(ink, 1e-6));
        for (let bucket = 0; bucket < AGE_BUCKETS; bucket++) {
            ctx.globalAlpha = Math.min(1, ageAlpha(bucket) * gain);
            for (let d = 0; d < 10; d++) {
                ctx.strokeStyle = THREAD_COLORS[d];
                ctx.stroke(paths[bucket * 10 + d]);
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        const last = count > 0 ? count - 1 : -1;
        const from = last >= 0 ? digits[last] : null;
        const to = last >= 0 ? digits[last + 1] : null;
        this.drawRing(cx, cy, R, from, to);

        // El hilo más nuevo, en oro.
        if (last >= 0 && from !== null && to !== null) {
            const i = first + last;
            const t0 = threadAngle(from, i);
            const t1 = threadAngle(to, i + 1);
            const x0 = cx + R * Math.cos(t0);
            const y0 = cy + R * Math.sin(t0);
            const x1 = cx + R * Math.cos(t1);
            const y1 = cy + R * Math.sin(t1);
            ctx.strokeStyle = '#f6e6c4';
            ctx.lineWidth = 1.6;
            ctx.shadowColor = 'rgba(216, 176, 106, 0.9)';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.quadraticCurveTo(
                cx + ((x0 + x1) / 2 - cx) * pull,
                cy + ((y0 + y1) / 2 - cy) * pull,
                x1,
                y1,
            );
            ctx.stroke();
            ctx.fillStyle = '#f6e6c4';
            for (const [x, y] of [
                [x0, y0],
                [x1, y1],
            ]) {
                ctx.beginPath();
                ctx.arc(x, y, 2.6, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
        }

        this.onInfo?.({ shown: count, from, to });
    }

    /** Arcos de colores y cifras alrededor del círculo. */
    private drawRing(
        cx: number,
        cy: number,
        R: number,
        from: number | null,
        to: number | null,
    ): void {
        const ctx = this.ctx;
        ctx.lineCap = 'round';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `500 13px ${this.font}`;
        for (let d = 0; d < 10; d++) {
            const lit = d === from || d === to;
            ctx.strokeStyle = THREAD_COLORS[d];
            ctx.globalAlpha = lit ? 1 : 0.7;
            ctx.lineWidth = lit ? 5 : 3;
            ctx.beginPath();
            ctx.arc(cx, cy, R + 7, arcStart(d), arcEnd(d));
            ctx.stroke();

            const mid = (arcStart(d) + arcEnd(d)) / 2;
            ctx.globalAlpha = 1;
            ctx.fillStyle = lit ? '#f6e6c4' : '#6f6a63';
            ctx.fillText(
                String(d),
                cx + (R + 26) * Math.cos(mid),
                cy + (R + 26) * Math.sin(mid),
            );
        }
        ctx.lineCap = 'butt';
    }
}
