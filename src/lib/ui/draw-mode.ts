import type { PiStream } from '../engine';
import { fmtInt } from '../format';
import type { ModeView } from '../modes';
import { MandalaCanvas } from '../renderers/mandala-canvas';
import { ThreadsCanvas } from '../renderers/threads-canvas';
import { $ } from './dom';

type Style = 'threads' | 'mandala';

const STORE_KEY = 'pi-infinito:dibujo';

interface Prefs {
    style: Style;
    window: number;
    symmetry: number;
}

const DEFAULTS: Prefs = {
    style: 'threads',
    window: 5000,
    symmetry: 6,
};

function loadPrefs(): Prefs {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return { ...DEFAULTS };
        const p = JSON.parse(raw) as Partial<Prefs>;
        return {
            style: p.style === 'mandala' ? 'mandala' : 'threads',
            window: [1000, 5000, 20000].includes(p.window ?? 0)
                ? (p.window as number)
                : DEFAULTS.window,
            symmetry: [6, 8, 12].includes(p.symmetry ?? 0)
                ? (p.symmetry as number)
                : DEFAULTS.symmetry,
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

/** Modo Dibujo: los dígitos de π como instrucciones para dibujar. */
export class DrawModeView implements ModeView {
    private readonly section: HTMLElement;
    private readonly threads: ThreadsCanvas;
    private readonly mandala: MandalaCanvas;
    private readonly prefs = loadPrefs();
    private stream: PiStream | null = null;
    private readonly el: {
        tShown: HTMLElement;
        tPair: HTMLElement;
        mSteps: HTMLElement;
        mCopies: HTMLElement;
    };

    constructor(section: HTMLElement) {
        this.section = section;
        this.threads = new ThreadsCanvas(
            $(section, '[data-threads]'),
        );
        this.mandala = new MandalaCanvas(
            $(section, '[data-mandala]'),
        );
        this.el = {
            tShown: $(section, '[data-t-shown]'),
            tPair: $(section, '[data-t-pair]'),
            mSteps: $(section, '[data-m-steps]'),
            mCopies: $(section, '[data-m-copies]'),
        };

        const floating = (style: Style): HTMLElement[] => [
            $(section, `.draw-info[data-for="${style}"]`),
            ...section.querySelectorAll<HTMLElement>(
                '.mode-dock .seg',
            ),
        ];
        this.threads.avoid = floating('threads');
        this.mandala.avoid = floating('mandala');

        this.threads.onInfo = (info) => {
            this.el.tShown.textContent = fmtInt(info.shown);
            this.el.tPair.textContent =
                info.from === null
                    ? '—'
                    : `${info.from} → ${info.to}`;
        };
        this.mandala.onInfo = (info) => {
            this.el.mSteps.textContent = fmtInt(info.steps);
            this.el.mCopies.textContent = String(info.symmetry * 2);
        };

        this.bindGroup('[data-draw-style]', (value) =>
            this.setStyle(value as Style),
        );
        this.bindGroup('[data-draw-window]', (value) => {
            this.prefs.window = Number(value);
            this.threads.setWindow(this.prefs.window);
            savePrefs(this.prefs);
        });
        this.bindGroup('[data-draw-symmetry]', (value) => {
            this.prefs.symmetry = Number(value);
            this.mandala.setSymmetry(this.prefs.symmetry);
            savePrefs(this.prefs);
        });

        this.threads.setWindow(this.prefs.window);
        this.mandala.setSymmetry(this.prefs.symmetry);
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
            this.syncButtons();
        });
    }

    private syncButtons(): void {
        const current: Record<string, string> = {
            '[data-draw-style]': this.prefs.style,
            '[data-draw-window]': String(this.prefs.window),
            '[data-draw-symmetry]': String(this.prefs.symmetry),
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
        savePrefs(this.prefs);
        this.section.dataset.style = style;
        if (this.stream) this.start(this.stream);
    }

    private start(stream: PiStream): void {
        if (this.prefs.style === 'threads') {
            this.mandala.pause();
            this.threads.setStream(stream);
        } else {
            this.threads.pause();
            this.mandala.setStream(stream);
        }
    }

    activate(stream: PiStream): void {
        this.stream = stream;
        this.start(stream);
    }

    deactivate(): void {
        this.threads.pause();
        this.mandala.pause();
    }

    update(): void {
        if (this.prefs.style === 'threads') this.threads.invalidate();
        else this.mandala.invalidate();
    }
}
