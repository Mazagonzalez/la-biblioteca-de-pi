import type { PiStream } from '../engine';
import { WalkPath } from '../walk';

/** Degradado del pasado (índigo) al presente (oro). */
const STOPS: [number, [number, number, number]][] = [
    [0, [52, 44, 110]],
    [0.35, [122, 74, 140]],
    [0.65, [194, 115, 106]],
    [0.88, [216, 176, 106]],
    [1, [246, 230, 196]],
];
const BUCKETS = 64;
const MIN_SPAN = 1 << 12;

function gradient(t: number): string {
    for (let i = 1; i < STOPS.length; i++) {
        const [t1, c1] = STOPS[i];
        if (t <= t1) {
            const [t0, c0] = STOPS[i - 1];
            const u = (t - t0) / (t1 - t0);
            const c = c0.map((v, k) =>
                Math.round(v + (c1[k] - v) * u),
            );
            return `rgb(${c[0]} ${c[1]} ${c[2]})`;
        }
    }
    const c = STOPS[STOPS.length - 1][1];
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

const COLORS = Array.from({ length: BUCKETS }, (_, i) =>
    gradient((i + 0.5) / BUCKETS),
);

interface View {
    /** Píxeles CSS por paso. */
    scale: number;
    /** Punto del mundo en el centro del canvas. */
    cx: number;
    cy: number;
}

export interface WalkInfo {
    steps: number;
    x: number;
    y: number;
    distance: number;
    auto: boolean;
}

/**
 * Dibuja la caminata. El trazado se acumula en un canvas: los pasos nuevos
 * se pintan encima y solo se redibuja todo si cambia el encuadre (el camino
 * se sale, zoom o paneo manual) o si el degradado debe re-escalarse.
 */
export class WalkCanvas {
    readonly root: HTMLElement;
    readonly path = new WalkPath();
    auto = true;
    onInfo: ((info: WalkInfo) => void) | null = null;
    onAutoChange: ((auto: boolean) => void) | null = null;

    private readonly base: HTMLCanvasElement;
    private readonly overlay: HTMLCanvasElement;
    private readonly bctx: CanvasRenderingContext2D;
    private readonly octx: CanvasRenderingContext2D;
    private readonly resizeObserver: ResizeObserver;
    private stream: PiStream | null = null;
    private view: View = { scale: 8, cx: 0, cy: 0 };
    private width = 0;
    private height = 0;
    private dpr = 1;
    /** Puntos ya dibujados en el canvas base. */
    private drawn = 0;
    /** Longitud de referencia del degradado (potencia de 2). */
    private span = MIN_SPAN;
    private needsFull = true;
    private frame = 0;
    private active = false;
    private pointers = new Map<number, { x: number; y: number }>();
    private pinchDistance = 0;

    constructor(root: HTMLElement) {
        this.root = root;
        root.classList.add('walk');
        this.base = document.createElement('canvas');
        this.overlay = document.createElement('canvas');
        this.base.className = 'walk-canvas';
        this.overlay.className = 'walk-canvas';
        const b = this.base.getContext('2d');
        const o = this.overlay.getContext('2d');
        if (!b || !o) throw new Error('Canvas 2D no disponible');
        this.bctx = b;
        this.octx = o;
        root.append(this.base, this.overlay);

        root.addEventListener('wheel', this.onWheel, {
            passive: false,
        });
        root.addEventListener('pointerdown', this.onPointerDown);
        root.addEventListener('pointermove', this.onPointerMove);
        root.addEventListener('pointerup', this.onPointerUp);
        root.addEventListener('pointercancel', this.onPointerUp);
        root.addEventListener('dblclick', () => this.setAuto(true));

        this.resizeObserver = new ResizeObserver(() => {
            this.resize();
            this.invalidate();
        });
        this.resizeObserver.observe(root);
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        this.active = true;
        this.needsFull = true;
        this.invalidate();
    }

    pause(): void {
        this.active = false;
    }

    invalidate(): void {
        if (this.frame || !this.active) return;
        this.frame = requestAnimationFrame(() => this.render());
    }

    setAuto(auto: boolean): void {
        if (this.auto !== auto) {
            this.auto = auto;
            this.onAutoChange?.(auto);
        }
        if (auto) {
            this.fit();
            this.needsFull = true;
            this.invalidate();
        }
    }

    zoomBy(
        factor: number,
        sx = this.width / 2,
        sy = this.height / 2,
    ): void {
        const v = this.view;
        const wx = (sx - this.width / 2) / v.scale + v.cx;
        const wy = (sy - this.height / 2) / v.scale + v.cy;
        v.scale = Math.min(80, Math.max(0.0005, v.scale * factor));
        v.cx = wx - (sx - this.width / 2) / v.scale;
        v.cy = wy - (sy - this.height / 2) / v.scale;
        this.setAuto(false);
        this.needsFull = true;
        this.invalidate();
    }

    // --- Geometría --------------------------------------------------------

    private resize(): void {
        const rect = this.root.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        for (const c of [this.base, this.overlay]) {
            c.width = Math.round(this.width * this.dpr);
            c.height = Math.round(this.height * this.dpr);
        }
        if (this.auto) this.fit();
        this.needsFull = true;
    }

    /** Encuadra el camino entero con margen. */
    private fit(): void {
        const p = this.path;
        const pad = Math.min(this.width, this.height) * 0.12 + 16;
        const w = p.maxX - p.minX + 1;
        const h = p.maxY - p.minY + 1;
        // Margen extra para no re-encuadrar en cada lote.
        const slack = 1.35;
        const scale = Math.min(
            (this.width - pad * 2) / (w * slack),
            (this.height - pad * 2) / (h * slack),
            24,
        );
        this.view = {
            scale: Math.max(0.0005, scale),
            cx: (p.minX + p.maxX) / 2,
            cy: (p.minY + p.maxY) / 2,
        };
    }

    /** ¿Cabe el camino en el encuadre actual (con un margen interior)? */
    private fits(): boolean {
        const p = this.path;
        const v = this.view;
        const m = 12;
        const left = (p.minX - v.cx) * v.scale + this.width / 2;
        const right = (p.maxX - v.cx) * v.scale + this.width / 2;
        const top = (p.minY - v.cy) * v.scale + this.height / 2;
        const bottom = (p.maxY - v.cy) * v.scale + this.height / 2;
        return (
            left >= m &&
            top >= m &&
            right <= this.width - m &&
            bottom <= this.height - m
        );
    }

    // --- Pintado ----------------------------------------------------------

    private render(): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream || !this.active) return;
        if (this.width <= 1) this.resize();

        const path = this.path;
        path.extend(stream.store);

        let span = this.span;
        while (span < path.length) span *= 2;
        if (span !== this.span) {
            this.span = span;
            this.needsFull = true;
        }
        if (this.auto && !this.fits()) {
            this.fit();
            this.needsFull = true;
        }

        if (this.needsFull) {
            this.needsFull = false;
            this.clear();
            this.drawRange(0, path.length);
        } else if (this.drawn < path.length) {
            this.drawRange(this.drawn - 1, path.length);
        }
        this.drawn = path.length;
        this.drawOverlay();

        const n = path.length - 1;
        const x = path.xs[n];
        const y = path.ys[n];
        this.onInfo?.({
            steps: n,
            x,
            y: -y,
            distance: Math.hypot(x, y),
            auto: this.auto,
        });
    }

    private clear(): void {
        const ctx = this.bctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.base.width, this.base.height);
    }

    /** Dibuja los segmentos entre los puntos [from, to). */
    private drawRange(from: number, to: number): void {
        from = Math.max(0, from);
        if (to - from < 2) return;
        const ctx = this.bctx;
        const { xs, ys } = this.path;
        const v = this.view;
        const k = v.scale * this.dpr;
        const ox = this.base.width / 2 - v.cx * k;
        const oy = this.base.height / 2 - v.cy * k;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.lineWidth =
            Math.max(1, Math.min(v.scale * 0.32, 3.5)) * this.dpr;
        ctx.globalAlpha = v.scale < 0.5 ? 0.75 : 0.95;

        const bucketSize = this.span / BUCKETS;
        let i = from;
        while (i < to - 1) {
            const bucket = Math.min(
                BUCKETS - 1,
                Math.floor(i / bucketSize),
            );
            const end = Math.min(
                to - 1,
                Math.floor((bucket + 1) * bucketSize),
            );
            ctx.beginPath();
            ctx.moveTo(xs[i] * k + ox, ys[i] * k + oy);
            for (let j = i + 1; j <= end; j++) {
                ctx.lineTo(xs[j] * k + ox, ys[j] * k + oy);
            }
            ctx.strokeStyle = COLORS[bucket];
            ctx.stroke();
            i = end;
        }
        ctx.globalAlpha = 1;
    }

    private drawOverlay(): void {
        const ctx = this.octx;
        const d = this.dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        const v = this.view;
        const toScreen = (x: number, y: number): [number, number] => [
            ((x - v.cx) * v.scale + this.width / 2) * d,
            ((y - v.cy) * v.scale + this.height / 2) * d,
        ];

        // Origen: anillo fino.
        const [sx, sy] = toScreen(0, 0);
        ctx.strokeStyle = 'rgba(237, 232, 223, 0.55)';
        ctx.lineWidth = 1.25 * d;
        ctx.beginPath();
        ctx.arc(sx, sy, 4.5 * d, 0, Math.PI * 2);
        ctx.stroke();

        // Cabeza: punto dorado con halo.
        const n = this.path.length - 1;
        const [hx, hy] = toScreen(this.path.xs[n], this.path.ys[n]);
        const glow = ctx.createRadialGradient(
            hx,
            hy,
            0,
            hx,
            hy,
            16 * d,
        );
        glow.addColorStop(0, 'rgba(216, 176, 106, 0.55)');
        glow.addColorStop(1, 'rgba(216, 176, 106, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(hx, hy, 16 * d, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f6e6c4';
        ctx.beginPath();
        ctx.arc(hx, hy, 2.6 * d, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Zoom y paneo -----------------------------------------------------

    private local(event: { clientX: number; clientY: number }): {
        x: number;
        y: number;
    } {
        const rect = this.root.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    private onWheel = (event: WheelEvent): void => {
        event.preventDefault();
        const { x, y } = this.local(event);
        this.zoomBy(Math.exp(-event.deltaY * 0.0015), x, y);
    };

    private onPointerDown = (event: PointerEvent): void => {
        if ((event.target as HTMLElement).closest('button')) return;
        this.root.setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, this.local(event));
        if (this.pointers.size === 2)
            this.pinchDistance = this.pinchSpread();
    };

    private onPointerMove = (event: PointerEvent): void => {
        const prev = this.pointers.get(event.pointerId);
        if (!prev) return;
        const next = this.local(event);
        if (this.pointers.size === 1) {
            const v = this.view;
            v.cx -= (next.x - prev.x) / v.scale;
            v.cy -= (next.y - prev.y) / v.scale;
            this.pointers.set(event.pointerId, next);
            this.setAuto(false);
            this.needsFull = true;
            this.invalidate();
            return;
        }
        this.pointers.set(event.pointerId, next);
        const spread = this.pinchSpread();
        if (this.pinchDistance > 0 && spread > 0) {
            const pts = [...this.pointers.values()];
            const mx = (pts[0].x + pts[1].x) / 2;
            const my = (pts[0].y + pts[1].y) / 2;
            this.zoomBy(spread / this.pinchDistance, mx, my);
        }
        this.pinchDistance = spread;
    };

    private onPointerUp = (event: PointerEvent): void => {
        this.pointers.delete(event.pointerId);
        if (this.pointers.size < 2) this.pinchDistance = 0;
    };

    private pinchSpread(): number {
        const pts = [...this.pointers.values()];
        if (pts.length < 2) return 0;
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
}
