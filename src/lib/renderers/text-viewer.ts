import { alphabetFor, formatInBase } from '../alphabet';
import type { PiStream } from '../engine';
import { fmtInt } from '../format';

/**
 * Los navegadores limitan la altura de un elemento (~16–33 M px). Por
 * encima de esto se escala el desplazamiento en lugar de crecer el espaciador.
 */
const MAX_SCROLL_HEIGHT = 8_000_000;
const OVERSCAN = 6;
const BLOCK = 10;
/** Distancia (px) al final a partir de la cual se considera "al final". */
const BOTTOM_SLACK = 4;

interface Row {
    el: HTMLDivElement;
    pos: HTMLSpanElement;
    text: HTMLSpanElement;
    key: string;
}

export interface TextViewerOptions {
    /** Máximo de bloques de 10 por fila (por estética). */
    maxBlocks?: number;
}

/**
 * Visor de texto virtualizado: solo existen en el DOM las filas visibles
 * (más un margen), así que aguanta millones de símbolos. Bloques de 10,
 * columna con la posición y modo "seguir al último".
 */
export class TextViewer {
    readonly root: HTMLElement;
    follow = true;
    onFollowChange: ((follow: boolean) => void) | null = null;

    private readonly spacer: HTMLDivElement;
    private readonly layer: HTMLDivElement;
    private readonly rows: Row[] = [];
    private readonly maxBlocks: number;
    private readonly resizeObserver: ResizeObserver;
    private stream: PiStream | null = null;
    private codes: number[] = [];
    private chars: number[] = [];
    private buffer = new Uint8Array(1024);

    private perRow = BLOCK;
    private rowHeight = 30;
    private padTop = 28;
    private padBottom = 72;
    private spacerHeight = -1;
    private frame = 0;
    private expectedTop = -1;
    private touching = false;
    private measured = false;
    private highlight: { start: number; end: number } | null = null;
    private highlightVersion = 0;

    constructor(root: HTMLElement, options: TextViewerOptions = {}) {
        this.root = root;
        this.maxBlocks = options.maxBlocks ?? 10;
        root.classList.add('viewer');

        this.spacer = document.createElement('div');
        this.spacer.className = 'viewer-spacer';
        this.layer = document.createElement('div');
        this.layer.className = 'viewer-layer';
        root.append(this.spacer, this.layer);

        root.addEventListener('scroll', this.onScroll, {
            passive: true,
        });
        root.addEventListener('wheel', this.onWheel, {
            passive: true,
        });
        root.addEventListener('keydown', this.onKey);
        root.addEventListener('touchstart', this.onTouchStart, {
            passive: true,
        });
        root.addEventListener('touchmove', this.onTouchMove, {
            passive: true,
        });
        root.addEventListener('touchend', this.onTouchEnd, {
            passive: true,
        });
        root.addEventListener('touchcancel', this.onTouchEnd, {
            passive: true,
        });

        this.resizeObserver = new ResizeObserver(() =>
            this.measure(),
        );
        this.resizeObserver.observe(root);
        void document.fonts?.ready.then(() => this.measure());
    }

    setStream(stream: PiStream): void {
        this.stream = stream;
        const alphabet = alphabetFor(stream.base);
        this.codes = Array.from(alphabet, (ch) => ch.charCodeAt(0));
        for (const row of this.rows) row.key = '';
        this.setFollow(true);
        this.invalidate();
    }

    /** Pide un repintado en el próximo frame. */
    invalidate(): void {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => this.render());
    }

    scrollToEnd(): void {
        this.setFollow(true);
        this.invalidate();
    }

    /** Índice del primer símbolo visible. */
    firstVisibleIndex(): number {
        const realTop = this.root.scrollTop * this.scrollRatio();
        const row = Math.max(
            0,
            Math.floor((realTop - this.padTop) / this.rowHeight),
        );
        return row * this.perRow;
    }

    /** Lleva el símbolo `index` al tercio superior y deja de seguir. */
    scrollToIndex(index: number): void {
        this.setFollow(false);
        const row = Math.floor(index / this.perRow);
        this.setRealTop(
            this.padTop +
                row * this.rowHeight -
                this.root.clientHeight / 3,
        );
        this.invalidate();
    }

    /** Resalta [start, start + length) (p. ej. un resultado de búsqueda). */
    setHighlight(start: number, length: number): void {
        this.highlight = { start, end: start + length };
        this.highlightVersion++;
        this.invalidate();
    }

    clearHighlight(): void {
        if (!this.highlight) return;
        this.highlight = null;
        this.highlightVersion++;
        this.invalidate();
    }

    destroy(): void {
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.root.removeEventListener('scroll', this.onScroll);
        this.root.removeEventListener('wheel', this.onWheel);
        this.root.removeEventListener('keydown', this.onKey);
        this.root.removeEventListener(
            'touchstart',
            this.onTouchStart,
        );
        this.root.removeEventListener('touchmove', this.onTouchMove);
        this.root.removeEventListener('touchend', this.onTouchEnd);
        this.root.removeEventListener('touchcancel', this.onTouchEnd);
        this.spacer.remove();
        this.layer.remove();
    }

    // --- Medidas ---------------------------------------------------------

    private measure(): void {
        const anchor = this.measured ? this.firstVisibleIndex() : 0;

        const probe = this.createRow();
        probe.el.style.visibility = 'hidden';
        probe.el.style.position = 'absolute';
        this.layer.append(probe.el);
        const block = '0'.repeat(BLOCK);
        probe.text.textContent = block;
        const one = probe.text.getBoundingClientRect().width;
        probe.text.textContent = `${block} ${block}`;
        const two = probe.text.getBoundingClientRect().width;
        const rowHeight = probe.el.getBoundingClientRect().height;
        const gutter = probe.pos.getBoundingClientRect().width;
        probe.el.remove();

        const layerStyle = getComputedStyle(this.layer);
        const padX =
            parseFloat(layerStyle.paddingLeft) +
            parseFloat(layerStyle.paddingRight);
        const gap = two - 2 * one;
        // Deja sitio para el cursor tras el último dígito.
        const available =
            this.root.clientWidth - padX - gutter - one / BLOCK;
        const blocks = Math.max(
            1,
            Math.min(
                this.maxBlocks,
                Math.floor((available + gap) / (one + gap)),
            ),
        );

        if (rowHeight > 0) this.rowHeight = rowHeight;
        const perRow = blocks * BLOCK;
        const changed = perRow !== this.perRow || !this.measured;
        this.perRow = perRow;
        this.measured = true;
        if (changed) {
            for (const row of this.rows) row.key = '';
            this.spacerHeight = -1;
            if (!this.follow) this.scrollToIndex(anchor);
        }
        this.invalidate();
    }

    private contentHeight(): number {
        const total = this.stream?.length ?? 0;
        const rows = Math.max(1, Math.ceil(total / this.perRow));
        return this.padTop + rows * this.rowHeight + this.padBottom;
    }

    /** Altura real del contenido por cada px de scroll. */
    private scrollRatio(): number {
        const view = this.root.clientHeight;
        const content = this.contentHeight();
        const spacer = Math.min(content, MAX_SCROLL_HEIGHT);
        return spacer > view ? (content - view) / (spacer - view) : 1;
    }

    private setRealTop(realTop: number): void {
        const top = Math.max(0, realTop / this.scrollRatio());
        this.root.scrollTop = top;
        this.expectedTop = this.root.scrollTop;
    }

    // --- Pintado ---------------------------------------------------------

    private render(): void {
        this.frame = 0;
        const stream = this.stream;
        if (!stream || !this.measured) return;

        const root = this.root;
        const total = stream.length;
        const perRow = this.perRow;
        const rowHeight = this.rowHeight;
        const rowCount = Math.max(1, Math.ceil(total / perRow));
        const content = this.contentHeight();
        const spacer = Math.min(content, MAX_SCROLL_HEIGHT);
        if (spacer !== this.spacerHeight) {
            this.spacer.style.height = `${spacer}px`;
            this.spacerHeight = spacer;
        }

        const view = root.clientHeight;
        if (this.follow && !this.touching) {
            const target = Math.max(0, spacer - view);
            if (Math.abs(root.scrollTop - target) > 0.5) {
                root.scrollTop = target;
            }
            this.expectedTop = root.scrollTop;
        }

        const scrollTop = root.scrollTop;
        const ratio =
            spacer > view ? (content - view) / (spacer - view) : 1;
        const realTop = scrollTop * ratio;
        const firstRow = Math.max(
            0,
            Math.floor((realTop - this.padTop) / rowHeight) - 2,
        );
        const lastRow = Math.min(
            rowCount - 1,
            firstRow + Math.ceil(view / rowHeight) + OVERSCAN,
        );

        const offset =
            scrollTop +
            (this.padTop + firstRow * rowHeight - realTop);
        this.layer.style.transform = `translate3d(0, ${offset}px, 0)`;

        const needed = lastRow - firstRow + 1;
        while (this.rows.length < needed) {
            const row = this.createRow();
            this.rows.push(row);
            this.layer.append(row.el);
        }

        for (let i = 0; i < this.rows.length; i++) {
            const row = this.rows[i];
            if (i >= needed) {
                if (row.key !== 'hidden') {
                    row.el.style.display = 'none';
                    row.key = 'hidden';
                }
                continue;
            }
            const index = firstRow + i;
            const start = index * perRow;
            const end = Math.min(total, start + perRow);
            const isLast = index === rowCount - 1;
            const hl = this.highlight;
            const marked =
                hl !== null &&
                hl.start < start + perRow &&
                hl.end > start;
            const key = `${index}|${end - start}|${perRow}|${isLast ? 1 : 0}|${marked ? this.highlightVersion : 0}`;
            if (row.key === key) continue;
            if (row.key === 'hidden') row.el.style.display = '';
            row.key = key;
            this.fillRow(row, stream, index, start, end, isLast);
        }
    }

    private fillRow(
        row: Row,
        stream: PiStream,
        index: number,
        start: number,
        end: number,
        isLast: boolean,
    ): void {
        if (index === 0) {
            row.pos.textContent = `${formatInBase(stream.integerPart, stream.base)}.`;
            row.pos.classList.add('is-int');
        } else {
            row.pos.textContent = fmtInt(start + 1);
            row.pos.classList.remove('is-int');
        }

        const count = end - start;
        if (this.buffer.length < count)
            this.buffer = new Uint8Array(count);
        stream.store.read(start, end, this.buffer);
        const chars = this.chars;
        chars.length = 0;
        const codes = this.codes;
        for (let i = 0; i < count; i++) {
            if (i > 0 && i % BLOCK === 0) chars.push(32);
            chars.push(codes[this.buffer[i]]);
        }
        const text = String.fromCharCode(...chars);
        const hl = this.highlight;
        if (hl && hl.start < end && hl.end > start) {
            // Desplazamiento en caracteres: un espacio cada BLOCK símbolos.
            const at = (i: number) => i + Math.floor(i / BLOCK);
            const a = Math.max(0, hl.start - start);
            const b = Math.min(count, hl.end - start);
            const from = at(a);
            const to = at(b - 1) + 1;
            const mark = document.createElement('mark');
            mark.className = 'vrow-mark';
            mark.textContent = text.slice(from, to);
            row.text.replaceChildren(
                text.slice(0, from),
                mark,
                text.slice(to),
            );
        } else {
            row.text.textContent = text;
        }
        row.el.classList.toggle('is-last', isLast);
    }

    private createRow(): Row {
        const el = document.createElement('div');
        el.className = 'vrow';
        const pos = document.createElement('span');
        pos.className = 'vrow-pos';
        pos.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.className = 'vrow-text';
        const caret = document.createElement('span');
        caret.className = 'vrow-caret';
        caret.setAttribute('aria-hidden', 'true');
        el.append(pos, text, caret);
        return { el, pos, text, key: '' };
    }

    // --- Seguir al último ------------------------------------------------

    private setFollow(follow: boolean): void {
        if (this.follow === follow) return;
        this.follow = follow;
        this.onFollowChange?.(follow);
    }

    private atBottom(): boolean {
        const root = this.root;
        return (
            root.scrollHeight - root.clientHeight - root.scrollTop <=
            BOTTOM_SLACK
        );
    }

    private onScroll = (): void => {
        if (this.atBottom()) {
            this.setFollow(true);
        } else if (
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

    private onKey = (event: KeyboardEvent): void => {
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            this.setFollow(false);
        } else if (event.key === 'End') {
            event.preventDefault();
            this.scrollToEnd();
        }
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
}
