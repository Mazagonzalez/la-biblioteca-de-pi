import type { PiStream } from '../engine';
import { THIN, fmtInt } from '../format';
import type { ModeView } from '../modes';
import { BW_PALETTE, DIGIT_PALETTE } from '../palette';
import { PixelCanvas } from '../renderers/pixel-canvas';
import { $ } from './dom';

const SIZES = [1, 2, 3, 4, 6, 8, 12, 16];

type Style = 'color' | 'bw';
const STORE_KEY = 'pi-infinito:color';
const PALETTES: Record<Style, readonly string[]> = {
    color: DIGIT_PALETTE,
    bw: BW_PALETTE,
};

function loadStyle(): Style {
    try {
        return localStorage.getItem(STORE_KEY) === 'bw'
            ? 'bw'
            : 'color';
    } catch {
        return 'color';
    }
}

function saveStyle(style: Style): void {
    try {
        localStorage.setItem(STORE_KEY, style);
    } catch {
        // Sin almacenamiento: el estilo dura lo que la visita.
    }
}

/** Modo Color: un píxel por dígito, en color o en blanco y negro. */
export class ColorModeView implements ModeView {
    private readonly section: HTMLElement;
    private readonly canvas: PixelCanvas;
    private readonly followBtn: HTMLButtonElement;
    private readonly sizeLabel: HTMLElement;
    private readonly tip: HTMLElement;
    private readonly styleGroup: HTMLElement;
    private size: number;
    private style: Style = loadStyle();

    constructor(section: HTMLElement) {
        this.section = section;
        this.followBtn = $<HTMLButtonElement>(
            section,
            '[data-follow]',
        );
        this.sizeLabel = $(section, '[data-cell-size]');
        this.tip = $(section, '[data-pixel-tip]');
        this.styleGroup = $(section, '[data-color-style]');
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
                    const shade =
                        this.style === 'bw'
                            ? info.digit < 5
                                ? ' · negro'
                                : ' · blanco'
                            : '';
                    this.tip.textContent = `${info.digit}${shade} · posición ${fmtInt(info.index + 1)}`;
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
        this.styleGroup.addEventListener('click', (event) => {
            const value = (
                event.target as HTMLElement
            ).closest<HTMLButtonElement>('button[data-value]')
                ?.dataset.value;
            if (value === 'color' || value === 'bw') {
                this.setStyle(value);
                saveStyle(value);
            }
        });
        this.setStyle(this.style);
        this.updateLabel();
    }

    private setStyle(style: Style): void {
        this.style = style;
        this.section.dataset.style = style;
        this.canvas.setPalette(PALETTES[style]);
        for (const btn of this.styleGroup.querySelectorAll<HTMLButtonElement>(
            'button[data-value]',
        )) {
            btn.setAttribute(
                'aria-pressed',
                String(btn.dataset.value === style),
            );
        }
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
