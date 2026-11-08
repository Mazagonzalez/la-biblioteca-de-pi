import type { PiStream } from '../engine';
import { fmtInt } from '../format';
import { DIGIT_PALETTE, paletteLut } from '../palette';

const BOTTOM_SLACK = 4;
const PAD_TOP = 24;
const PAD_BOTTOM = 72;

export interface PixelCanvasCallbacks {
    onFollowChange?: (follow: boolean) => void;
    onHover?: (
        info: {
            index: number;
            digit: number;
            x: number;
            y: number;
        } | null,
    ) => void;
}

/**
 * Cada dígito es un píxel del canvas, ampliado `cell` veces con
 * `image-rendering: pixelated`. Se llena fila por fila; el número de
 * columnas depende del ancho. Solo se pinta la franja visible (con
 * ImageData), así que el coste por frame no crece con el total.
 */
export class PixelCanvas {
    readonly root: HTMLElement;
    follow = true;
    cell: number;

    private readonly spacer: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly lut = paletteLut(DIGIT_PALETTE);
    private readonly resizeObserver: ResizeObserver;
    private readonly callbacks: PixelCanvasCallbacks;
    private stream: PiStream | null = null;
    private image: ImageData | null = null;
    private pixels: Uint32Array | null = null;
    private buffer = new Uint8Array(1024);
    private cols = 1;
    private padX = 0;
    private frame = 0;
    private expectedTop = -1;
    private touching = false;

    constructor(
        root: HTMLElement,
        cell: number,
        callbacks: PixelCanvasCallbacks = {},
    ) {
        this.root = root;
        this.cell = cell;
        this.callbacks = callbacks;
        root.classList.add('pixels');
        this.spacer = document.createElement('div');
        this.spacer.className = 'pixels-spacer';
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'pixels-canvas';
        const ctx = this.canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Canvas 2D no disponible');
        this.ctx = ctx;
        root.append(this.spacer, this.canvas);

        root.addEventListener('scroll', this.onScroll, {
            passive: true,
        });
        root.addEventListener('wheel', this.onWheel, {
            passive: true,
        });
        root.addEventListener('touchstart', this.onTouchStart, {
            passive: true,
        });
        root.addEventListener('touchmove', this.onTouchMove, {
            passive: true,
        });
        root.addEventListener('touchend', this.onTouchEnd, {
            passive: true,
        });
        root.addEventListener('pointermove', this.onPointerMove);
        root.addEventListener('pointerleave', this.onPointerLeave);

        this.resizeObserver = new ResizeObserver(() =>
            this.invalidate(),
        );
        this.resizeObserver.observe(root);
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        this.invalidate();
    }

    setCell(cell: number): void {
        const anchor = this.firstVisibleIndex();
        this.cell = cell;
        if (!this.follow) {
            this.layout();
            this.scrollToIndex(anchor);
        }
        this.invalidate();
    }

    scrollToEnd(): void {
        this.setFollow(true);
        this.invalidate();
    }

    invalidate(): void {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => this.render());
    }

    private firstVisibleIndex(): number {
        const row = Math.max(
            0,
            Math.floor((this.root.scrollTop - PAD_TOP) / this.cell),
        );
        return row * this.cols;
    }

    private scrollToIndex(index: number): void {
        const row = Math.floor(index / this.cols);
        this.root.scrollTop = PAD_TOP + row * this.cell;
        this.expectedTop = this.root.scrollTop;
    }

    /** Recalcula columnas y altura del contenido. */
    private layout(): number {
        const width = this.root.clientWidth;
        const inset = Math.min(56, Math.max(12, width * 0.04));
        this.cols = Math.max(
            1,
            Math.floor((width - inset * 2) / this.cell),
        );
        this.padX = Math.floor((width - this.cols * this.cell) / 2);
        const total = this.stream?.length ?? 0;
        const rows = Math.max(1, Math.ceil(total / this.cols));
        const height = PAD_TOP + rows * this.cell + PAD_BOTTOM;
        this.spacer.style.height = `${height}px`;
        return rows;
    }

    private render(): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream) return;
        const root = this.root;
        const cell = this.cell;
        const totalRows = this.layout();
        const view = root.clientHeight;

        if (this.follow && !this.touching) {
            const target = Math.max(0, root.scrollHeight - view);
            if (Math.abs(root.scrollTop - target) > 0.5)
                root.scrollTop = target;
            this.expectedTop = root.scrollTop;
        }

        const scrollTop = root.scrollTop;
        const firstRow = Math.max(
            0,
            Math.floor((scrollTop - PAD_TOP) / cell),
        );
        const visibleRows = Math.min(
            Math.ceil(view / cell) + 2,
            Math.max(0, totalRows - firstRow),
        );
        const cols = this.cols;
        const canvas = this.canvas;

        if (
            canvas.width !== cols ||
            canvas.height !== Math.max(1, visibleRows)
        ) {
            canvas.width = cols;
            canvas.height = Math.max(1, visibleRows);
            this.image = this.ctx.createImageData(
                canvas.width,
                canvas.height,
            );
            this.pixels = new Uint32Array(this.image.data.buffer);
        }
        canvas.style.width = `${cols * cell}px`;
        canvas.style.height = `${canvas.height * cell}px`;
        canvas.style.transform = `translate3d(${this.padX}px, ${PAD_TOP + firstRow * cell}px, 0)`;

        const pixels = this.pixels;
        const image = this.image;
        if (!pixels || !image) return;
        pixels.fill(0);
        const start = firstRow * cols;
        const end = Math.min(
            stream.length,
            start + canvas.height * cols,
        );
        const count = Math.max(0, end - start);
        if (this.buffer.length < count)
            this.buffer = new Uint8Array(count);
        stream.store.read(start, end, this.buffer);
        const lut = this.lut;
        const buf = this.buffer;
        for (let i = 0; i < count; i++) pixels[i] = lut[buf[i]];
        this.ctx.putImageData(image, 0, 0);
    }

    // --- Interacción ------------------------------------------------------

    private setFollow(follow: boolean): void {
        if (this.follow === follow) return;
        this.follow = follow;
        this.callbacks.onFollowChange?.(follow);
    }

    private atBottom(): boolean {
        const r = this.root;
        return (
            r.scrollHeight - r.clientHeight - r.scrollTop <=
            BOTTOM_SLACK
        );
    }

    private onScroll = (): void => {
        if (this.atBottom()) this.setFollow(true);
        else if (
            this.follow &&
            Math.abs(this.root.scrollTop - this.expectedTop) > 1
        ) {
            this.setFollow(false);
        }
        this.invalidate();
    };

    private onWheel = (event: WheelEvent): void => {
        if (event.deltaY < 0) this.setFollow(false);
    };

    private onTouchStart = (): void => {
        this.touching = true;
    };

    private onTouchMove = (): void => {
        if (!this.atBottom()) this.setFollow(false);
    };

    private onTouchEnd = (): void => {
        this.touching = false;
        this.invalidate();
    };

    private onPointerMove = (event: PointerEvent): void => {
        const stream = this.stream;
        if (!stream || event.pointerType === 'touch') return;
        const rect = this.root.getBoundingClientRect();
        const x = event.clientX - rect.left - this.padX;
        const y =
            event.clientY - rect.top + this.root.scrollTop - PAD_TOP;
        const col = Math.floor(x / this.cell);
        const row = Math.floor(y / this.cell);
        const index = row * this.cols + col;
        if (
            col < 0 ||
            col >= this.cols ||
            row < 0 ||
            index >= stream.length
        ) {
            this.callbacks.onHover?.(null);
            return;
        }
        this.callbacks.onHover?.({
            index,
            digit: stream.store.at(index),
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        });
    };

    private onPointerLeave = (): void => {
        this.callbacks.onHover?.(null);
    };
}

export function describePixel(index: number, digit: number): string {
    return `posición ${fmtInt(index + 1)} · ${digit}`;
}
