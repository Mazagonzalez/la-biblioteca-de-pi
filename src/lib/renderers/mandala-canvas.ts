import { fitRadius, foldAngle, Walk10 } from '../drawing';
import type { PiStream } from '../engine';
import { timeBuckets } from './gradient';
import { boxesWithin } from './obstacles';

/** Tramos de color, del centro (índigo) al borde (oro). */
const BUCKETS = 48;
const COLORS = timeBuckets(BUCKETS);
/** Segmentos por trazo antes de vaciarlo. */
const FLUSH = 160;
/** Holgura del encuadre sobre el radio máximo del camino. */
const SLACK = 1.2;

export interface MandalaInfo {
    steps: number;
    symmetry: number;
}

/**
 * Mandala: la caminata de 10 direcciones de π, doblada dentro de una cuña
 * de π/S radianes y repetida 2·S veces (giros y espejos), como en un
 * caleidoscopio.
 *
 * El trazo se acumula en un canvas aparte que solo contiene la cuña; cada
 * cuadro se compone girándolo y reflejándolo con drawImage, que es barato.
 * Solo se redibuja la cuña entera si el camino se sale del encuadre o si
 * cambia la simetría.
 */
export class MandalaCanvas {
    readonly root: HTMLElement;
    readonly path = new Walk10();
    onInfo: ((info: MandalaInfo) => void) | null = null;
    /** Elementos encima del dibujo que el mandala no debe pisar. */
    avoid: HTMLElement[] = [];

    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly wedge: HTMLCanvasElement;
    private readonly wctx: CanvasRenderingContext2D;
    private stream: PiStream | null = null;
    private symmetry = 6;
    private width = 0;
    private height = 0;
    private dpr = 1;
    /** Lado del canvas de la cuña, en píxeles del dispositivo. */
    private side = 0;
    /** Radio del mundo que cabe en el encuadre (en pasos). */
    private reach = 24;
    /** Opacidad del trazo, fijada en cada redibujo completo. */
    private alpha = 0.4;
    private drawn = 0;
    private needsFull = true;
    private frame = 0;
    private active = false;

    constructor(root: HTMLElement) {
        this.root = root;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'draw-canvas';
        this.wedge = document.createElement('canvas');
        const ctx = this.canvas.getContext('2d');
        const wctx = this.wedge.getContext('2d');
        if (!ctx || !wctx) throw new Error('Canvas 2D no disponible');
        this.ctx = ctx;
        this.wctx = wctx;
        root.append(this.canvas);
        new ResizeObserver(() => {
            this.resize();
            this.invalidate();
        }).observe(root);
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        this.active = true;
        this.invalidate();
    }

    pause(): void {
        this.active = false;
    }

    setSymmetry(symmetry: number): void {
        if (symmetry === this.symmetry) return;
        this.symmetry = symmetry;
        this.needsFull = true;
        this.invalidate();
    }

    invalidate(): void {
        if (this.frame || !this.active) return;
        this.frame = requestAnimationFrame(() => this.render());
    }

    private resize(): void {
        const rect = this.root.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        const radius = fitRadius(
            this.width,
            this.height,
            12,
            boxesWithin(this.root, this.avoid),
            10,
        );
        this.side = Math.max(1, Math.round(radius * 2 * this.dpr));
        this.wedge.width = this.side;
        this.wedge.height = this.side;
        this.needsFull = true;
    }

    private render(): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream || !this.active) return;
        if (this.width <= 1) this.resize();
        if (this.width <= 1) return;

        const path = this.path;
        path.extend(stream.store);
        if (path.maxR > this.reach * 0.97) {
            // Margen para no re-encuadrar en cada lote.
            this.reach = Math.max(24, path.maxR * SLACK);
            this.needsFull = true;
        }

        if (this.needsFull) {
            this.needsFull = false;
            this.wctx.setTransform(1, 0, 0, 1, 0, 0);
            this.wctx.clearRect(0, 0, this.side, this.side);
            this.alpha = this.fitAlpha();
            this.drawRange(0, path.length);
        } else if (this.drawn < path.length) {
            this.drawRange(this.drawn - 1, path.length);
        }
        this.drawn = path.length;
        this.compose();
        this.onInfo?.({ steps: path.steps, symmetry: this.symmetry });
    }

    private get lineWidth(): number {
        return Math.max(
            0.75 * this.dpr,
            Math.min(this.k * 0.5, 2.5 * this.dpr),
        );
    }

    /**
     * Cuanto más tinta cae en la cuña (pasos × grosor sobre su área), más
     * transparente el trazo, para que el dibujo no se queme a blanco.
     */
    private fitAlpha(): number {
        const n = Math.max(1, this.path.steps);
        const wedgeArea =
            (Math.PI * (this.side / 2) ** 2) / (2 * this.symmetry);
        const ink = (n * this.k * this.lineWidth) / wedgeArea;
        // Raíz: suaviza el ajuste para que los brazos sueltos no se apaguen.
        return Math.min(0.6, Math.max(0.12, 0.45 / Math.sqrt(ink)));
    }

    /** Escala del mundo (pasos) a píxeles de la cuña. */
    private get k(): number {
        return this.side / 2 / this.reach;
    }

    /**
     * Dibuja en la cuña los segmentos entre los puntos [from, to). El color
     * depende de la distancia al centro (anillos, como en un mandala) y el
     * trazo es translúcido y aditivo: donde el camino pasa muchas veces,
     * brilla más.
     */
    private drawRange(from: number, to: number): void {
        from = Math.max(0, from);
        if (to - from < 2) return;
        const ctx = this.wctx;
        const { xs, ys } = this.path;
        const k = this.k;
        const c = this.side / 2;
        const s = this.symmetry;
        // El borde del color es el radio máximo al encuadrar.
        const colorScale = (BUCKETS * SLACK) / (this.reach * k);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth = this.lineWidth;
        ctx.globalAlpha = this.alpha;
        ctx.globalCompositeOperation = 'lighter';

        // Un trazo por tramo de color, vaciado cada FLUSH segmentos para
        // que los cruces se sumen (un solo trazo no se suma consigo mismo).
        const paths: (Path2D | null)[] = new Array(BUCKETS).fill(
            null,
        );
        const counts = new Uint16Array(BUCKETS);
        const flush = (b: number): void => {
            const p = paths[b];
            if (!p) return;
            ctx.strokeStyle = COLORS[b];
            ctx.stroke(p);
            paths[b] = null;
            counts[b] = 0;
        };

        let px = 0;
        let py = 0;
        for (let i = from; i < to; i++) {
            const x = xs[i];
            const y = ys[i];
            const r = Math.hypot(x, y) * k;
            const t = foldAngle(Math.atan2(y, x), s);
            const qx = c + r * Math.cos(t);
            const qy = c + r * Math.sin(t);
            if (i > from) {
                const b = Math.min(
                    BUCKETS - 1,
                    Math.floor(r * colorScale),
                );
                let p = paths[b];
                if (!p) p = paths[b] = new Path2D();
                p.moveTo(px, py);
                p.lineTo(qx, qy);
                if (++counts[b] >= FLUSH) flush(b);
            }
            px = qx;
            py = qy;
        }
        for (let b = 0; b < BUCKETS; b++) flush(b);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    /** Repite la cuña 2·S veces y marca la cabeza en cada copia. */
    private compose(): void {
        const ctx = this.ctx;
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        const s = this.symmetry;
        const half = this.side / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Cabeza: dónde va la caminata ahora, doblada en la cuña.
        const n = this.path.length - 1;
        const hx = this.path.xs[n];
        const hy = this.path.ys[n];
        const hr = Math.hypot(hx, hy) * this.k;
        const ht = foldAngle(Math.atan2(hy, hx), s);
        const headX = hr * Math.cos(ht);
        const headY = hr * Math.sin(ht);
        const d = this.dpr;

        for (let m = 0; m < 2; m++) {
            for (let j = 0; j < s; j++) {
                // El eje de la cuña apunta hacia arriba.
                const angle = (j * 2 * Math.PI) / s - Math.PI / 2;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                const flip = m === 0 ? 1 : -1;
                ctx.setTransform(
                    cos,
                    sin,
                    -sin * flip,
                    cos * flip,
                    cx,
                    cy,
                );
                ctx.drawImage(this.wedge, -half, -half);

                const glow = ctx.createRadialGradient(
                    headX,
                    headY,
                    0,
                    headX,
                    headY,
                    12 * d,
                );
                glow.addColorStop(0, 'rgba(216, 176, 106, 0.5)');
                glow.addColorStop(1, 'rgba(216, 176, 106, 0)');
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(headX, headY, 12 * d, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#f6e6c4';
                ctx.beginPath();
                ctx.arc(headX, headY, 1.9 * d, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
