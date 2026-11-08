import { alphabetFor } from '@/lib/alphabet';
import { PiEngine, type PiStream } from '@/lib/engine';
import { fmtInt, fmtRate, numberWord } from '@/lib/format';
import {
    MODES,
    modeByHash,
    modeById,
    type ModeDef,
    type ModeId,
    type ModeView,
} from '@/lib/modes';
import type { RunRecord } from '@/lib/stats';
import { ColorModeView } from '@/lib/ui/color-mode';
import { $ } from '@/lib/ui/dom';
import { SearchController } from '@/lib/ui/search';
import { SoundModeView } from '@/lib/ui/sound-mode';
import { StatsPanel } from '@/lib/ui/stats-panel';
import { TextModeView } from '@/lib/ui/text-mode';
import { Toast } from '@/lib/ui/toast';
import { WalkModeView } from '@/lib/ui/walk-mode';

/** Las rachas más cortas que esto no merecen aviso. */
const MIN_RECORD_TOAST = 3;

const initial = modeByHash(location.hash) ?? MODES[0];
const engine = new PiEngine(initial.base);
const panel = new StatsPanel($(document, '[data-stats]'));
const toast = new Toast($(document, '[data-toast]'));

const toggleBtn = $<HTMLButtonElement>(document, '[data-toggle]');
const headerCount = $(document, '[data-h-count]');
const headerUnit = $(document, '[data-h-unit]');
const headerRate = $(document, '[data-h-rate]');

// --- Modos -------------------------------------------------------------

const sections = new Map<ModeId, HTMLElement>();
for (const mode of MODES) {
    sections.set(
        mode.id,
        $(document, `[data-mode-view="${mode.id}"]`),
    );
}

/** Las vistas se crean la primera vez que se usan. */
const factories: Record<ModeId, (section: HTMLElement) => ModeView> =
    {
        digits: (s) => new TextModeView(s),
        letters: (s) => new TextModeView(s),
        color: (s) => new ColorModeView(s),
        walk: (s) => new WalkModeView(s),
        sound: (s) => new SoundModeView(s),
    };
const views = new Map<ModeId, ModeView>();

function viewFor(id: ModeId): ModeView {
    let view = views.get(id);
    if (!view) {
        const section = sections.get(id);
        if (!section) throw new Error(`Sin sección para ${id}`);
        view = factories[id](section);
        views.set(id, view);
    }
    return view;
}

let current: ModeDef | null = null;

function setMode(mode: ModeDef, updateHash = true): void {
    if (current?.id === mode.id) return;
    if (current) viewFor(current.id).deactivate();
    current = mode;

    for (const [id, section] of sections) {
        section.dataset.active = String(id === mode.id);
        section.inert = id !== mode.id;
    }
    for (const tab of document.querySelectorAll<HTMLElement>(
        '.mode-tab[data-mode]',
    )) {
        if (tab.dataset.mode === mode.id)
            tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    }
    document.documentElement.dataset.activeMode = mode.id;

    engine.setBase(mode.base);
    viewFor(mode.id).activate(engine.stream(mode.base));
    if (updateHash && location.hash !== `#${mode.hash}`) {
        history.replaceState(null, '', `#${mode.hash}`);
    }
    scheduleUi();
}

for (const tab of document.querySelectorAll<HTMLAnchorElement>(
    '.mode-tab[data-mode]',
)) {
    tab.addEventListener('click', (event) => {
        event.preventDefault();
        const mode = modeById(tab.dataset.mode ?? '');
        if (mode) setMode(mode);
    });
}
$(document, '[data-home]').addEventListener('click', (event) => {
    event.preventDefault();
    setMode(MODES[0]);
});
window.addEventListener('hashchange', () => {
    const mode = modeByHash(location.hash);
    if (mode) setMode(mode, false);
});

// --- Repintado del panel y la cabecera (como mucho una vez por frame) --

let uiFrame = 0;
function scheduleUi(): void {
    if (uiFrame) return;
    uiFrame = requestAnimationFrame(() => {
        uiFrame = 0;
        const stream = engine.active;
        panel.update(stream, engine.paused);
        headerCount.textContent = fmtInt(stream.length);
        headerUnit.textContent =
            stream.base === 26 ? 'letras' : 'díg.';
        headerRate.textContent = engine.paused
            ? 'en pausa'
            : `${fmtRate(stream.speed.rate)} /s`;
    });
}

engine.onBatch((stream) => {
    if (stream.base !== engine.activeBase || !current) return;
    viewFor(current.id).update(stream);
    scheduleUi();
});

engine.onState(() => {
    const paused = engine.paused;
    document.documentElement.dataset.paused = String(paused);
    toggleBtn.setAttribute('aria-pressed', String(paused));
    toggleBtn.setAttribute(
        'aria-label',
        paused ? 'Reanudar el cálculo' : 'Pausar el cálculo',
    );
    toggleBtn.title = paused
        ? 'Reanudar (espacio)'
        : 'Pausar (espacio)';
    scheduleUi();
});

// --- Récords de rachas -------------------------------------------------

function describeRecord(stream: PiStream, record: RunRecord) {
    const glyph = alphabetFor(stream.base)[record.symbol];
    const title = `Nueva racha récord: ${numberWord(record.length)} «${glyph}» seguidos`;
    const feynman =
        stream.base === 10 &&
        record.symbol === 9 &&
        record.length === 6 &&
        record.position === 762;
    const detail = feynman
        ? 'Posición 762: el punto de Feynman.'
        : `Desde la posición ${fmtInt(record.position)} · base ${stream.base}.`;
    return { title, detail };
}

engine.onRecord((stream, record) => {
    if (stream.base !== engine.activeBase) return;
    if (record.length < MIN_RECORD_TOAST) return;
    const { title, detail } = describeRecord(stream, record);
    toast.show(title, detail);
});

// --- Búsqueda ----------------------------------------------------------

function textModeFor(base: 10 | 26): ModeDef {
    const mode = modeById(base === 10 ? 'digits' : 'letters');
    if (!mode) throw new Error('Modo de texto ausente');
    return mode;
}

const search = new SearchController(engine, {
    onStart(base) {
        // Si ya estamos en un modo de esa base (p. ej. Color para base 10)
        // se queda; si no, pasa al modo de texto correspondiente.
        if (current?.base !== base) setMode(textModeFor(base));
        for (const id of ['digits', 'letters'] as const) {
            (
                views.get(id) as TextModeView | undefined
            )?.viewer.clearHighlight();
        }
    },
    onReveal(base, index, length) {
        const mode = textModeFor(base);
        setMode(mode);
        (viewFor(mode.id) as TextModeView).reveal(index, length);
    },
    onClear() {
        for (const id of ['digits', 'letters'] as const) {
            (
                views.get(id) as TextModeView | undefined
            )?.viewer.clearHighlight();
        }
    },
});

const searchForm = $<HTMLFormElement>(document, '[data-search]');
const searchInput = $<HTMLInputElement>(searchForm, 'input');
const searchOpen = $<HTMLButtonElement>(
    document,
    '[data-search-open]',
);

function openSearch(open: boolean): void {
    searchForm.dataset.open = String(open);
    searchOpen.setAttribute('aria-expanded', String(open));
    if (open) searchInput.focus();
}
searchOpen.addEventListener('click', () => openSearch(true));
$(searchForm, '[data-search-close]').addEventListener('click', () => {
    openSearch(false);
});
searchForm.addEventListener('submit', () => {
    if (window.matchMedia('(max-width: 1023px)').matches)
        openSearch(false);
});

// --- Controles ---------------------------------------------------------

toggleBtn.addEventListener('click', () => engine.toggle());

document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target?.closest('input, textarea, select');
    if (event.key === '/' && !typing) {
        event.preventDefault();
        openSearch(true);
        return;
    }
    if (event.code !== 'Space' || event.repeat || typing) return;
    if (target?.closest('button, a, summary')) return;
    event.preventDefault();
    engine.toggle();
});

setMode(initial, false);
void search;

// El tiempo de cálculo avanza aunque no lleguen lotes visibles.
setInterval(scheduleUi, 1000);
scheduleUi();
