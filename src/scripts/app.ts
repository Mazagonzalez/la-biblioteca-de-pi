import { alphabetFor } from '@/lib/alphabet';
import { PiEngine, type PiStream } from '@/lib/engine';
import { fmtInt, fmtRate, numberWord } from '@/lib/format';
import { TextViewer } from '@/lib/renderers/text-viewer';
import type { RunRecord } from '@/lib/stats';
import { StatsPanel } from '@/lib/ui/stats-panel';
import { Toast } from '@/lib/ui/toast';

function $<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = document.querySelector<T>(sel);
    if (!el) throw new Error(`Falta el elemento ${sel}`);
    return el;
}

/** Las rachas más cortas que esto no merecen aviso. */
const MIN_RECORD_TOAST = 3;

const engine = new PiEngine(10);
const viewer = new TextViewer($('[data-viewer]'));
const panel = new StatsPanel($('[data-stats]'));
const toast = new Toast($('[data-toast]'));

const toggleBtn = $<HTMLButtonElement>('[data-toggle]');
const followBtn = $<HTMLButtonElement>('[data-follow]');
const headerCount = $('[data-h-count]');
const headerRate = $('[data-h-rate]');

viewer.setStream(engine.active);

// --- Repintado del panel y la cabecera (como mucho una vez por frame) --

let uiFrame = 0;
function scheduleUi(): void {
    if (uiFrame) return;
    uiFrame = requestAnimationFrame(() => {
        uiFrame = 0;
        const stream = engine.active;
        panel.update(stream, engine.paused);
        headerCount.textContent = fmtInt(stream.length);
        headerRate.textContent = engine.paused
            ? 'en pausa'
            : `${fmtRate(stream.speed.rate)} /s`;
    });
}

engine.onBatch((stream) => {
    if (stream.base !== engine.activeBase) return;
    viewer.invalidate();
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
        : `Desde la posición ${fmtInt(record.position)}.`;
    return { title, detail };
}

engine.onRecord((stream, record) => {
    if (stream.base !== engine.activeBase) return;
    if (record.length < MIN_RECORD_TOAST) return;
    const { title, detail } = describeRecord(stream, record);
    toast.show(title, detail);
});

// --- Controles ---------------------------------------------------------

toggleBtn.addEventListener('click', () => engine.toggle());

document.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (
        target?.closest('input, textarea, select, button, a, summary')
    ) {
        return;
    }
    event.preventDefault();
    engine.toggle();
});

viewer.onFollowChange = (follow) => {
    followBtn.dataset.visible = String(!follow);
};
followBtn.addEventListener('click', () => viewer.scrollToEnd());

// El tiempo de cálculo avanza aunque no lleguen lotes visibles.
setInterval(scheduleUi, 1000);
scheduleUi();
