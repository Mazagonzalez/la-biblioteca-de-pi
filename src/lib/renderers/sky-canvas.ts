import type { PiStream } from '../engine';
import { fmtInt } from '../format';
import { Sky } from '../sky';
import { boxesWithin } from './obstacles';

/** Estrellas sueltas de fondo (de constelaciones ya viejas). */
const FIELD_STARS = 4000;
/** Duración máxima del trazado de la constelación nueva (ms). */
const REVEAL_MS = 900;
/** Ancho del desvanecido en los bordes del cielo (px CSS). */
const EDGE_FADE = 48;
const AGE_BUCKETS = 8;

/** Colores de estrella, de azuladas a cálidas, según el brillo. */
const STAR_COLORS = [
    [169, 193, 255],
    [202, 215, 255],
    [248, 247, 255],
    [255, 244, 232],
    [255, 217, 178],
] as const;

function starColor(mag: number): number {
    return mag % STAR_COLORS.length;
}

/** Halo de estrella dibujado una vez y reutilizado con drawImage. */
function makeSprite(rgb: readonly number[]): HTMLCanvasElement {
    const size = 64;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return c;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const [r, gr, b] = rgb;
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.12, `rgba(${r}, ${gr}, ${b}, 0.95)`);
    g.addColorStop(0.35, `rgba(${r}, ${gr}, ${b}, 0.22)`);
    g.addColorStop(1, `rgba(${r}, ${gr}, ${b}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return c;
}

export interface SkyInfo {
    groups: number;
    stars: number;
    /** Estrellas de la constelación más nueva. */
    lastSize: number | null;
}

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Constelaciones: cada grupo de decimales es una constelación (ver
 * `sky.ts`). Se ven con líneas las últimas `window`; las anteriores quedan
 * como estrellas sueltas de fondo. La más nueva se traza en dorado.
 *
 * Lo que no cambia entre cuadros (fondo y constelaciones ya trazadas) se
 * pinta en una capa aparte solo cuando llega una constelación; la
 * animación de la nueva solo compone esa capa y la dibuja encima.
 */
export class SkyCanvas {
    readonly root: HTMLElement;
    readonly sky = new Sky();
    onInfo: ((info: SkyInfo) => void) | null = null;
    /** Elementos encima del dibujo que el cielo no debe pisar. */
    avoid: HTMLElement[] = [];

    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly layer: HTMLCanvasElement;
    private readonly lctx: CanvasRenderingContext2D;
    private sprites: HTMLCanvasElement[] = [];
    private stream: PiStream | null = null;
    private window = 100;
    private width = 0;
    private height = 0;
    private dpr = 1;
    private font = 'monospace';
    private rect: Rect = { left: 0, top: 0, width: 1, height: 1 };
    /** Constelaciones pintadas en la capa fija. */
    private layered = -1;
    private revealStart = 0;
    /** Tamaño de las estrellas según el área del cielo. */
    private starScale = 1;
    /** Duración del trazado actual: más corta si llegan muy seguido. */
    private revealMs = REVEAL_MS;
    private frame = 0;
    private active = false;

    constructor(root: HTMLElement) {
        this.root = root;
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'draw-canvas';
        this.layer = document.createElement('canvas');
        const ctx = this.canvas.getContext('2d');
        const lctx = this.layer.getContext('2d');
        if (!ctx || !lctx) throw new Error('Canvas 2D no disponible');
        this.ctx = ctx;
        this.lctx = lctx;
        root.append(this.canvas);
        new ResizeObserver(() => {
            this.resize();
            this.invalidate();
        }).observe(root);
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        this.active = true;
        this.layered = -1;
        this.invalidate();
    }

    pause(): void {
        this.active = false;
    }

    setWindow(groups: number): void {
        this.window = groups;
        this.layered = -1;
        this.invalidate();
    }

    invalidate(): void {
        if (this.frame || !this.active) return;
        this.frame = requestAnimationFrame((t) => this.render(t));
    }

    private resize(): void {
        const rect = this.root.getBoundingClientRect();
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        for (const c of [this.canvas, this.layer]) {
            c.width = Math.round(this.width * this.dpr);
            c.height = Math.round(this.height * this.dpr);
        }
        this.font =
            getComputedStyle(this.root)
                .getPropertyValue('--font-mono')
                .trim() || 'monospace';

        // El cielo ocupa lo que dejan libre los textos (arriba) y los
        // botones (abajo).
        const pad = 22;
        let top = pad;
        let bottom = this.height - pad;
        for (const b of boxesWithin(this.root, this.avoid)) {
            if (b.right <= b.left || b.bottom <= b.top) continue;
            if (b.top < this.height / 2)
                top = Math.max(top, b.bottom + 18);
            else bottom = Math.min(bottom, b.top - 18);
        }
        if (bottom - top < this.height * 0.4) {
            top = pad;
            bottom = this.height - pad;
        }
        this.rect = {
            left: pad,
            top,
            width: Math.max(1, this.width - pad * 2),
            height: Math.max(1, bottom - top),
        };
        // En pantallas chicas, estrellas más chicas para no amontonarlas.
        this.starScale = Math.min(
            1.15,
            Math.max(
                0.7,
                Math.sqrt(
                    (this.rect.width * this.rect.height) /
                        (460 * 380),
                ),
            ),
        );
        this.layered = -1;
    }

    private render(now: number): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream || !this.active) return;
        if (this.width <= 1) this.resize();
        if (this.width <= 1) return;
        if (this.sprites.length === 0)
            this.sprites = STAR_COLORS.map((c) => makeSprite(c));

        const sky = this.sky;
        const before = sky.groups;
        sky.extend(stream.store);
        if (sky.groups !== before && this.layered >= 0) {
            // Llegó una constelación: se traza la nueva desde cero.
            const since = now - this.revealStart;
            this.revealMs = Math.min(
                REVEAL_MS,
                Math.max(120, since * 0.8),
            );
            this.revealStart = now;
        }
        if (this.layered !== sky.groups) this.paintLayer();

        const progress =
            this.layered > 0 && before > 0
                ? Math.min(
                      1,
                      (now - this.revealStart) / this.revealMs,
                  )
                : 1;
        const ctx = this.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.drawImage(this.layer, 0, 0);
        if (sky.groups > 0) this.paintNewest(progress);

        this.onInfo?.({
            groups: sky.groups,
            stars: sky.stars,
            lastSize:
                sky.groups > 0
                    ? sky.starts[sky.groups] -
                      sky.starts[sky.groups - 1]
                    : null,
        });
        if (progress < 1) this.invalidate();
    }

    private sx(x: number): number {
        return (this.rect.left + x * this.rect.width) * this.dpr;
    }

    private sy(y: number): number {
        return (this.rect.top + y * this.rect.height) * this.dpr;
    }

    private star(
        ctx: CanvasRenderingContext2D,
        i: number,
        scale: number,
        alpha: number,
    ): void {
        const mag = this.sky.mags[i];
        const size =
            (5 + mag * 1.6) * scale * this.starScale * this.dpr;
        ctx.globalAlpha = alpha;
        ctx.drawImage(
            this.sprites[starColor(mag)],
            this.sx(this.sky.xs[i]) - size / 2,
            this.sy(this.sky.ys[i]) - size / 2,
            size,
            size,
        );
    }

    /** Fondo de estrellas sueltas y constelaciones ya trazadas. */
    private paintLayer(): void {
        const sky = this.sky;
        const ctx = this.lctx;
        const d = this.dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.layer.width, this.layer.height);
        this.layered = sky.groups;
        // La más nueva se dibuja aparte (animada).
        const last = sky.groups - 1;
        if (last < 0) return;
        const firstGroup = Math.max(0, last - this.window);
        const lineStart = sky.starts[firstGroup];

        // Estrellas sueltas: puntos tenues agrupados por brillo.
        const fieldFrom = Math.max(0, lineStart - FIELD_STARS);
        const dots = Array.from({ length: 10 }, () => new Path2D());
        for (let i = fieldFrom; i < lineStart; i++) {
            const mag = sky.mags[i];
            const r = (0.3 + mag * 0.06) * d;
            const x = this.sx(sky.xs[i]);
            const y = this.sy(sky.ys[i]);
            dots[mag].moveTo(x + r, y);
            dots[mag].arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#dcd6f0';
        for (let mag = 0; mag < 10; mag++) {
            ctx.globalAlpha = 0.1 + mag * 0.04;
            ctx.fill(dots[mag]);
        }

        // Líneas de las constelaciones recientes, más tenues cuanto más
        // viejas.
        const span = Math.max(1, last - firstGroup);
        const lines = Array.from(
            { length: AGE_BUCKETS },
            () => new Path2D(),
        );
        for (let g = firstGroup; g < last; g++) {
            const bucket = Math.min(
                AGE_BUCKETS - 1,
                Math.floor(((g - firstGroup) / span) * AGE_BUCKETS),
            );
            const path = lines[bucket];
            for (
                let e = sky.edgeStarts[g];
                e < sky.edgeStarts[g + 1];
                e++
            ) {
                const a = sky.edges[e * 2];
                const b = sky.edges[e * 2 + 1];
                path.moveTo(this.sx(sky.xs[a]), this.sy(sky.ys[a]));
                path.lineTo(this.sx(sky.xs[b]), this.sy(sky.ys[b]));
            }
        }
        ctx.lineWidth = 0.8 * d;
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgb(216, 176, 106)';
        for (let bucket = 0; bucket < AGE_BUCKETS; bucket++) {
            const t = (bucket + 1) / AGE_BUCKETS;
            ctx.globalAlpha = 0.06 + 0.4 * t * t;
            ctx.stroke(lines[bucket]);
        }

        // Sus estrellas, con halo.
        ctx.globalCompositeOperation = 'lighter';
        for (let g = firstGroup; g < last; g++) {
            const t = (g - firstGroup + 1) / span;
            for (let i = sky.starts[g]; i < sky.starts[g + 1]; i++) {
                this.star(ctx, i, 0.75, 0.35 + 0.55 * t);
            }
        }
        ctx.globalAlpha = 1;
        this.fadeEdges(ctx);
        ctx.globalCompositeOperation = 'source-over';
    }

    /** Desvanece los bordes del cielo para que no se vea un recuadro. */
    private fadeEdges(ctx: CanvasRenderingContext2D): void {
        const d = this.dpr;
        const { left, top, width, height } = this.rect;
        const x0 = left * d;
        const y0 = top * d;
        const x1 = (left + width) * d;
        const y1 = (top + height) * d;
        const f = EDGE_FADE * d;
        ctx.globalCompositeOperation = 'destination-out';
        const edge = (
            ax: number,
            ay: number,
            bx: number,
            by: number,
            rx: number,
            ry: number,
            rw: number,
            rh: number,
        ) => {
            const g = ctx.createLinearGradient(ax, ay, bx, by);
            g.addColorStop(0, 'rgba(0, 0, 0, 1)');
            g.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = g;
            ctx.fillRect(rx, ry, rw, rh);
        };
        const W = this.layer.width;
        const H = this.layer.height;
        // Todo lo que queda fuera del cielo, y una franja que se apaga.
        edge(x0 - 1, 0, x0 + f, 0, 0, 0, x0 + f, H);
        edge(x1 + 1, 0, x1 - f, 0, x1 - f, 0, W - x1 + f, H);
        edge(0, y0 - 1, 0, y0 + f, 0, 0, W, y0 + f);
        edge(0, y1 + 1, 0, y1 - f, 0, y1 - f, W, H - y1 + f);
    }

    /** La constelación más nueva, trazándose línea a línea. */
    private paintNewest(progress: number): void {
        const sky = this.sky;
        const ctx = this.ctx;
        const d = this.dpr;
        const g = sky.groups - 1;
        const e0 = sky.edgeStarts[g];
        const edges = sky.edgeStarts[g + 1] - e0;
        const drawnEdges = progress * edges;

        ctx.lineCap = 'round';
        ctx.lineWidth = 1.4 * d;
        ctx.strokeStyle = 'rgba(246, 230, 196, 0.95)';
        ctx.shadowColor = 'rgba(216, 176, 106, 0.9)';
        ctx.shadowBlur = 8 * d;
        ctx.beginPath();
        const shown = new Set<number>([sky.edges[e0 * 2]]);
        for (let k = 0; k < edges; k++) {
            const part = Math.min(1, drawnEdges - k);
            if (part <= 0) break;
            const a = sky.edges[(e0 + k) * 2];
            const b = sky.edges[(e0 + k) * 2 + 1];
            const ax = this.sx(sky.xs[a]);
            const ay = this.sy(sky.ys[a]);
            const bx = this.sx(sky.xs[b]);
            const by = this.sy(sky.ys[b]);
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax + (bx - ax) * part, ay + (by - ay) * part);
            if (part >= 1) shown.add(b);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.globalCompositeOperation = 'lighter';
        for (const i of shown) this.star(ctx, i, 1.15, 1);
        ctx.globalCompositeOperation = 'source-over';

        // Número de la constelación, junto a su primera estrella.
        const first = sky.starts[g];
        ctx.globalAlpha = Math.min(1, progress * 2) * 0.85;
        ctx.fillStyle = '#d8b06a';
        ctx.font = `${11 * d}px ${this.font}`;
        const x = this.sx(sky.xs[first]);
        const y = this.sy(sky.ys[first]);
        const label = `nº ${fmtInt(g + 1)}`;
        const right = x + 12 * d + ctx.measureText(label).width;
        ctx.textAlign =
            right > this.canvas.width - 8 * d ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            label,
            ctx.textAlign === 'right' ? x - 12 * d : x + 12 * d,
            y - 12 * d,
        );
        ctx.globalAlpha = 1;
    }
}
