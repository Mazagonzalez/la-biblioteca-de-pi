import type { PiEngine, PiStream } from '../engine';
import { fmtInt } from '../format';
import {
    IncrementalSearch,
    expectedPosition,
    parseQuery,
    type ParsedQuery,
} from '../search';
import { $ } from './dom';

/** Presupuesto por porción de búsqueda en el hilo principal (ms). */
const SLICE_MS = 6;

const compact = new Intl.NumberFormat('es', {
    notation: 'compact',
    maximumFractionDigits: 1,
});

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** ~b^k legible: «457 mil», «309 M» o, si es enorme, «10²⁰». */
function fmtExpected(base: number, length: number): string {
    const value = base ** length;
    if (value < 1e9) return compact.format(value);
    const exp = String(length).replace(/\d/g, (d) => SUPERSCRIPT[+d]);
    return `${base}${exp}`;
}

export interface SearchHooks {
    /** La búsqueda empieza: hay que mostrar el modo de texto de esa base. */
    onStart(base: 10 | 26): void;
    /** Encontrada (o la persona pulsó «ver»): saltar y resaltar. */
    onReveal(base: 10 | 26, index: number, length: number): void;
    /** Se cerró la búsqueda. */
    onClear(): void;
}

/**
 * Buscador: interpreta la consulta, revisa lo ya calculado en porciones
 * de pocos milisegundos (sin bloquear el hilo principal) y sigue con cada
 * lote nuevo hasta encontrarla.
 */
export class SearchController {
    private readonly engine: PiEngine;
    private readonly hooks: SearchHooks;
    private readonly form: HTMLFormElement;
    private readonly input: HTMLInputElement;
    private readonly status: HTMLElement;
    private readonly text: HTMLElement;
    private readonly go: HTMLButtonElement;
    private query: ParsedQuery | null = null;
    private search: IncrementalSearch | null = null;
    private timer = 0;

    constructor(engine: PiEngine, hooks: SearchHooks) {
        this.engine = engine;
        this.hooks = hooks;
        this.form = $<HTMLFormElement>(document, '[data-search]');
        this.input = $<HTMLInputElement>(this.form, 'input');
        this.status = $(document, '[data-search-status]');
        this.text = $(this.status, '[data-search-text]');
        this.go = $<HTMLButtonElement>(
            this.status,
            '[data-search-go]',
        );

        this.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.start(this.input.value);
        });
        this.input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.input.blur();
                this.clear();
            }
        });
        $(this.status, '[data-search-clear]').addEventListener(
            'click',
            () => this.clear(),
        );
        this.go.addEventListener('click', () => this.reveal());

        engine.onBatch((stream) => {
            if (
                this.search &&
                !this.search.done &&
                stream.base === this.query?.base
            ) {
                this.schedule();
            }
        });
        engine.onState(() => this.render());
    }

    start(raw: string): void {
        const parsed = parseQuery(raw);
        if (!parsed) {
            this.clear();
            return;
        }
        if (!parsed.ok) {
            this.query = null;
            this.search = null;
            this.show('error', parsed.error);
            return;
        }
        this.query = parsed.query;
        this.search = new IncrementalSearch(parsed.query.symbols);
        this.hooks.onStart(parsed.query.base);
        this.render();
        this.schedule();
    }

    clear(): void {
        clearTimeout(this.timer);
        this.query = null;
        this.search = null;
        this.input.value = '';
        this.status.dataset.state = 'idle';
        this.hooks.onClear();
    }

    private stream(): PiStream | null {
        return this.query
            ? this.engine.stream(this.query.base)
            : null;
    }

    private schedule(): void {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.step(), 0);
    }

    private step(): void {
        const search = this.search;
        const stream = this.stream();
        if (!search || !stream || search.done) return;
        const found = search.advance(
            stream.store,
            performance.now() + SLICE_MS,
        );
        if (found) {
            this.render();
            this.reveal();
            return;
        }
        if (search.scanned < stream.length) this.schedule();
        this.render();
    }

    private reveal(): void {
        const q = this.query;
        const s = this.search;
        if (!q || !s || !s.done) return;
        this.hooks.onReveal(q.base, s.found, q.symbols.length);
    }

    private render(): void {
        const q = this.query;
        const s = this.search;
        if (!q || !s) return;
        const label = `«${q.text}»`;
        if (s.done) {
            this.show(
                'found',
                `${label} aparece en la posición ${fmtInt(s.found + 1)}`,
            );
            return;
        }
        const expected = expectedPosition(q.base, q.symbols.length);
        const where = q.base === 10 ? 'Dígitos' : 'Letras';
        const paused =
            this.engine.activeBase !== q.base
                ? ` · sigue al volver a ${where}`
                : this.engine.paused
                  ? ' · cálculo en pausa'
                  : '';
        const hint =
            expected > 2e7
                ? ` · suele aparecer hacia la posición ~${fmtExpected(q.base, q.symbols.length)}: puede tardar muchísimo`
                : ` · suele aparecer hacia la ~${fmtExpected(q.base, q.symbols.length)}`;
        this.show(
            'searching',
            `Buscando ${label} · ${fmtInt(s.scanned)} revisadas${hint}${paused}`,
        );
    }

    private show(
        state: 'searching' | 'found' | 'error',
        message: string,
    ): void {
        this.status.dataset.state = state;
        this.text.textContent = message;
        this.go.hidden = state !== 'found';
    }
}
