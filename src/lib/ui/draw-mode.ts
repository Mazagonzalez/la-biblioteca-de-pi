import type { PiStream } from '../engine';
import { fmtInt, numberWord } from '../format';
import type { ModeView } from '../modes';
import { MandalaCanvas } from '../renderers/mandala-canvas';
import { SkyCanvas } from '../renderers/sky-canvas';
import { ThreadsCanvas } from '../renderers/threads-canvas';
import { $ } from './dom';

type Style = 'threads' | 'mandala' | 'sky';
const STYLES: readonly Style[] = ['threads', 'mandala', 'sky'];

const STORE_KEY = 'pi-infinito:dibujo';

interface Prefs {
    style: Style;
    window: number;
    symmetry: number;
    skyWindow: number;
}

const DEFAULTS: Prefs = {
    style: 'threads',
    window: 5000,
    symmetry: 6,
    skyWindow: 100,
};

function pick<T>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

function loadPrefs(): Prefs {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return { ...DEFAULTS };
        const p = JSON.parse(raw) as Partial<Prefs>;
        return {
            style: pick(p.style, STYLES, DEFAULTS.style),
            window: pick(
                p.window,
                [1000, 5000, 20000],
                DEFAULTS.window,
            ),
            symmetry: pick(p.symmetry, [6, 8, 12], DEFAULTS.symmetry),
            skyWindow: pick(
                p.skyWindow,
                [25, 100, 400],
                DEFAULTS.skyWindow,
            ),
        };
    } catch {
        return { ...DEFAULTS };
    }
}

function savePrefs(prefs: Prefs): void {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch {
        // Sin almacenamiento: las preferencias duran lo que la visita.
    }
}

/** Lo que cada lienzo de dibujo sabe hacer. */
interface Drawing {
    avoid: HTMLElement[];
    setStream(stream: PiStream): void;
    pause(): void;
    invalidate(): void;
}

/** Modo Dibujo: los dígitos de π como instrucciones para dibujar. */
export class DrawModeView implements ModeView {
    private readonly section: HTMLElement;
    private readonly threads: ThreadsCanvas;
    private readonly mandala: MandalaCanvas;
    private readonly sky: SkyCanvas;
    private readonly drawings: Record<Style, Drawing>;
    private readonly prefs = loadPrefs();
    private stream: PiStream | null = null;

    constructor(section: HTMLElement) {
        this.section = section;
        this.threads = new ThreadsCanvas(
            $(section, '[data-threads]'),
        );
        this.mandala = new MandalaCanvas(
            $(section, '[data-mandala]'),
        );
        this.sky = new SkyCanvas($(section, '[data-sky]'));
        this.drawings = {
            threads: this.threads,
            mandala: this.mandala,
            sky: this.sky,
        };

        for (const style of STYLES) {
            this.drawings[style].avoid = [
                $(section, `.draw-info[data-for="${style}"]`),
                ...section.querySelectorAll<HTMLElement>(
                    '.mode-dock .seg',
                ),
            ];
        }

        const text = (selector: string) => $(section, selector);
        const tShown = text('[data-t-shown]');
        const tPair = text('[data-t-pair]');
        const mSteps = text('[data-m-steps]');
        const mCopies = text('[data-m-copies]');
        const sGroups = text('[data-k-groups]');
        const sStars = text('[data-k-stars]');
        const sLast = text('[data-k-last]');

        this.threads.onInfo = (info) => {
            tShown.textContent = fmtInt(info.shown);
            tPair.textContent =
                info.from === null
                    ? '—'
                    : `${info.from} → ${info.to}`;
        };
        this.mandala.onInfo = (info) => {
            mSteps.textContent = fmtInt(info.steps);
            mCopies.textContent = String(info.symmetry * 2);
        };
        this.sky.onInfo = (info) => {
            sGroups.textContent = fmtInt(info.groups);
            sStars.textContent = fmtInt(info.stars);
            sLast.textContent =
                info.lastSize === null
                    ? '—'
                    : `${numberWord(info.lastSize)} estrellas`;
        };

        this.bindGroup('[data-draw-style]', (value) =>
            this.setStyle(pick(value, STYLES, this.prefs.style)),
        );
        this.bindGroup('[data-draw-window]', (value) => {
            this.prefs.window = Number(value);
            this.threads.setWindow(this.prefs.window);
        });
        this.bindGroup('[data-draw-symmetry]', (value) => {
            this.prefs.symmetry = Number(value);
            this.mandala.setSymmetry(this.prefs.symmetry);
        });
        this.bindGroup('[data-draw-sky]', (value) => {
            this.prefs.skyWindow = Number(value);
            this.sky.setWindow(this.prefs.skyWindow);
        });

        this.threads.setWindow(this.prefs.window);
        this.mandala.setSymmetry(this.prefs.symmetry);
        this.sky.setWindow(this.prefs.skyWindow);
        this.syncButtons();
        this.section.dataset.style = this.prefs.style;
    }

    /** Botones de un grupo segmentado: marcan aria-pressed y avisan. */
    private bindGroup(
        selector: string,
        onPick: (value: string) => void,
    ): void {
        const group = $(this.section, selector);
        group.addEventListener('click', (event) => {
            const btn = (
                event.target as HTMLElement
            ).closest<HTMLButtonElement>('button[data-value]');
            if (!btn?.dataset.value) return;
            onPick(btn.dataset.value);
            savePrefs(this.prefs);
            this.syncButtons();
        });
    }

    private syncButtons(): void {
        const current: Record<string, string> = {
            '[data-draw-style]': this.prefs.style,
            '[data-draw-window]': String(this.prefs.window),
            '[data-draw-symmetry]': String(this.prefs.symmetry),
            '[data-draw-sky]': String(this.prefs.skyWindow),
        };
        for (const [selector, value] of Object.entries(current)) {
            for (const btn of $(
                this.section,
                selector,
            ).querySelectorAll<HTMLButtonElement>(
                'button[data-value]',
            )) {
                btn.setAttribute(
                    'aria-pressed',
                    String(btn.dataset.value === value),
                );
            }
        }
    }

    private setStyle(style: Style): void {
        if (style === this.prefs.style) return;
        this.prefs.style = style;
        this.section.dataset.style = style;
        if (this.stream) this.start(this.stream);
    }

    private start(stream: PiStream): void {
        for (const style of STYLES) {
            if (style !== this.prefs.style)
                this.drawings[style].pause();
        }
        this.drawings[this.prefs.style].setStream(stream);
    }

    activate(stream: PiStream): void {
        this.stream = stream;
        this.start(stream);
    }

    deactivate(): void {
        for (const style of STYLES) this.drawings[style].pause();
    }

    update(): void {
        this.drawings[this.prefs.style].invalidate();
    }
}
