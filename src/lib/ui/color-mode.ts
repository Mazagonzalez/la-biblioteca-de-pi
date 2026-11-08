import type { PiStream } from '../engine';
import { THIN, fmtInt } from '../format';
import type { ModeView } from '../modes';
import { PixelCanvas } from '../renderers/pixel-canvas';
import { $ } from './dom';

const SIZES = [1, 2, 3, 4, 6, 8, 12, 16];

/** Modo Color: un píxel por dígito. */
export class ColorModeView implements ModeView {
    private readonly canvas: PixelCanvas;
    private readonly followBtn: HTMLButtonElement;
    private readonly sizeLabel: HTMLElement;
    private readonly tip: HTMLElement;
    private size: number;

    constructor(section: HTMLElement) {
        this.followBtn = $<HTMLButtonElement>(
            section,
            '[data-follow]',
        );
        this.sizeLabel = $(section, '[data-cell-size]');
        this.tip = $(section, '[data-pixel-tip]');
        const narrow = window.matchMedia(
            '(max-width: 640px)',
        ).matches;
        this.size = narrow ? 3 : 4;

        this.canvas = new PixelCanvas(
            $(section, '[data-pixels]'),
            this.size,
            {
                onFollowChange: (follow) => {
                    this.followBtn.dataset.visible = String(!follow);
                },
                onHover: (info) => {
                    if (!info) {
                        this.tip.dataset.visible = 'false';
                        return;
                    }
                    this.tip.textContent = `${info.digit} · posición ${fmtInt(info.index + 1)}`;
                    this.tip.style.transform = `translate(${info.x + 14}px, ${info.y + 14}px)`;
                    this.tip.dataset.visible = 'true';
                },
            },
        );
        this.followBtn.addEventListener('click', () =>
            this.canvas.scrollToEnd(),
        );

        $(section, '[data-zoom-in]').addEventListener('click', () =>
            this.step(1),
        );
        $(section, '[data-zoom-out]').addEventListener('click', () =>
            this.step(-1),
        );
        this.updateLabel();
    }

    private step(dir: 1 | -1): void {
        const i = SIZES.indexOf(this.size);
        const next =
            SIZES[Math.min(SIZES.length - 1, Math.max(0, i + dir))];
        if (next === this.size) return;
        this.size = next;
        this.canvas.setCell(next);
        this.updateLabel();
    }

    private updateLabel(): void {
        this.sizeLabel.textContent = `${this.size}${THIN}px`;
    }

    activate(stream: PiStream): void {
        this.canvas.setStream(stream);
    }

    deactivate(): void {
        this.tip.dataset.visible = 'false';
    }

    update(): void {
        this.canvas.invalidate();
    }
}
