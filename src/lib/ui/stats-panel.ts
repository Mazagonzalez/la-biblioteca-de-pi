import { alphabetFor } from '../alphabet';
import type { PiStream } from '../engine';
import {
    fmtDecimal,
    fmtDuration,
    fmtInt,
    fmtP,
    fmtPercent,
    fmtRate,
    THIN,
} from '../format';

function $<T extends Element = HTMLElement>(
    root: ParentNode,
    sel: string,
): T {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`Falta el elemento ${sel}`);
    return el;
}

/** Panel de aleatoriedad: cálculo, histograma, χ² y rachas. */
export class StatsPanel {
    private readonly root: HTMLElement;
    private readonly el: {
        digits: HTMLElement;
        base: HTMLElement;
        elapsed: HTMLElement;
        rate: HTMLElement;
        spark: SVGPolylineElement;
        status: HTMLElement;
        hist: HTMLElement;
        expected: HTMLElement;
        devScale: HTMLElement;
        chi: HTMLElement;
        df: HTMLElement;
        p: HTMLElement;
        marker: HTMLElement;
        verdict: HTMLElement;
        runGlyphs: HTMLElement;
        runMeta: HTMLElement;
        runCurrent: HTMLElement;
        summary: HTMLElement;
    };
    private bars: HTMLElement[] = [];
    private devs: HTMLElement[] = [];
    private ref: HTMLElement | null = null;
    private base = 0;

    constructor(root: HTMLElement) {
        this.root = root;
        this.el = {
            digits: $(root, '[data-s-digits]'),
            base: $(root, '[data-s-base]'),
            elapsed: $(root, '[data-s-elapsed]'),
            rate: $(root, '[data-s-rate]'),
            spark: $<SVGPolylineElement>(root, '[data-s-spark]'),
            status: $(root, '[data-s-status]'),
            hist: $(root, '[data-s-hist]'),
            expected: $(root, '[data-s-expected]'),
            devScale: $(root, '[data-s-dev-scale]'),
            chi: $(root, '[data-s-chi]'),
            df: $(root, '[data-s-df]'),
            p: $(root, '[data-s-p]'),
            marker: $(root, '[data-s-marker]'),
            verdict: $(root, '[data-s-verdict]'),
            runGlyphs: $(root, '[data-s-run-glyphs]'),
            runMeta: $(root, '[data-s-run-meta]'),
            runCurrent: $(root, '[data-s-run-current]'),
            summary: $(root, '[data-s-summary]'),
        };

        const toggle = root.querySelector<HTMLButtonElement>(
            '[data-stats-toggle]',
        );
        toggle?.addEventListener('click', () => {
            const open = root.dataset.open !== 'true';
            root.dataset.open = String(open);
            toggle.setAttribute('aria-expanded', String(open));
        });
    }

    /** Reconstruye el histograma si cambió la base. */
    private build(base: number): void {
        if (base === this.base) return;
        this.base = base;
        const alphabet = alphabetFor(base);
        const hist = this.el.hist;
        hist.style.setProperty('--n', String(base));
        hist.replaceChildren();

        const plot = document.createElement('div');
        plot.className = 'hist-plot';
        const ref = document.createElement('div');
        ref.className = 'hist-ref';
        plot.append(ref);
        this.ref = ref;

        const barsRow = document.createElement('div');
        barsRow.className = 'hist-row';
        const labelsRow = document.createElement('div');
        labelsRow.className = 'hist-row hist-labels';
        const devRow = document.createElement('div');
        devRow.className = 'hist-row hist-devs';

        this.bars = [];
        this.devs = [];
        for (let i = 0; i < base; i++) {
            const col = document.createElement('div');
            col.className = 'hist-col';
            const bar = document.createElement('div');
            bar.className = 'hist-bar';
            col.append(bar);
            barsRow.append(col);
            this.bars.push(bar);

            const label = document.createElement('span');
            label.textContent = alphabet[i];
            labelsRow.append(label);

            const devCol = document.createElement('div');
            devCol.className = 'hist-dev';
            const dev = document.createElement('div');
            devCol.append(dev);
            devRow.append(devCol);
            this.devs.push(dev);
        }
        plot.append(barsRow);
        hist.append(plot, labelsRow, devRow);

        this.el.base.textContent = String(base);
        const unit = this.root.querySelector('[data-s-unit]');
        if (unit)
            unit.textContent = base === 26 ? 'letras' : 'dígitos';
        this.el.df.textContent = String(base - 1);
        this.el.expected.textContent = `esperado ${fmtDecimal(100 / base, base > 10 ? 2 : 0)}${THIN}%`;
    }

    update(stream: PiStream, paused: boolean): void {
        this.build(stream.base);
        const { stats, speed } = stream;
        const el = this.el;
        const alphabet = alphabetFor(stream.base);

        // Cálculo
        el.digits.textContent = fmtInt(stream.length);
        el.elapsed.textContent = fmtDuration(stream.computeMs);
        el.rate.textContent = paused ? '—' : fmtRate(speed.rate);
        el.status.textContent = paused ? 'en pausa' : 'calculando';
        this.root.dataset.paused = String(paused);
        this.drawSpark(speed.history);

        // Histograma
        const freqs = stats.frequencies();
        const expected = 1 / stream.base;
        let maxF = 0;
        let maxDev = 0;
        for (let i = 0; i < freqs.length; i++) {
            maxF = Math.max(maxF, freqs[i]);
            maxDev = Math.max(
                maxDev,
                Math.abs(freqs[i] / expected - 1),
            );
        }
        const yMax = Math.max(expected * 1.5, maxF * 1.06);
        if (this.ref) {
            this.ref.style.bottom = `${(expected / yMax) * 100}%`;
        }
        // Escala "bonita" para la desviación relativa: 1, 2, 5 × 10ⁿ %.
        const scale = niceCeil(Math.max(maxDev, 0.001));
        for (let i = 0; i < this.bars.length; i++) {
            this.bars[i].style.transform =
                `scaleY(${freqs[i] / yMax})`;
            const rel = stats.total ? freqs[i] / expected - 1 : 0;
            const dev = this.devs[i];
            dev.style.transform = `scaleY(${Math.abs(rel) / scale})`;
            dev.classList.toggle('is-neg', rel < 0);
            const bar = this.bars[i].parentElement;
            if (bar) {
                bar.title = `${alphabet[i]}: ${fmtInt(stats.counts[i])} (${fmtDecimal(freqs[i] * 100, 3)} %)`;
            }
        }
        el.devScale.textContent = `±${fmtDecimal(scale * 100, scale < 0.01 ? 2 : 1)}${THIN}%`;

        // χ²
        const chi = stats.chiSquare();
        el.chi.textContent = fmtDecimal(chi.chi2, 2);
        el.p.textContent = fmtP(chi.p);
        el.marker.style.left = `${chi.p * 100}%`;
        el.marker.classList.toggle('is-low', chi.p < 0.05);
        el.verdict.textContent = verdict(
            stats.total,
            stream.base,
            chi.p,
        );
        el.summary.textContent = `χ² ${fmtDecimal(chi.chi2, 1)} · p ${fmtP(chi.p)}`;

        // Rachas
        const best = stats.best;
        if (best.length > 0) {
            const glyph = alphabet[best.symbol];
            el.runGlyphs.textContent =
                best.length <= 10
                    ? glyph.repeat(best.length)
                    : `${glyph.repeat(4)}…${glyph.repeat(4)}`;
            el.runMeta.textContent = `${best.length} × «${glyph}» · desde la posición ${fmtInt(best.position)}`;
        }
        const current = stats.currentRun;
        if (current.length > 0) {
            el.runCurrent.textContent = `${current.length} × «${alphabet[current.symbol]}»`;
        }
    }

    private drawSpark(history: number[]): void {
        const line = this.el.spark;
        if (history.length < 2) {
            line.setAttribute('points', '');
            return;
        }
        const max = Math.max(...history) || 1;
        const n = history.length;
        let points = '';
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 100;
            const y = 28 - (history[i] / max) * 26;
            points += `${x.toFixed(2)},${y.toFixed(2)} `;
        }
        line.setAttribute('points', points);
    }
}

function niceCeil(x: number): number {
    const exp = Math.floor(Math.log10(x));
    const base = 10 ** exp;
    for (const m of [1, 2, 5, 10]) {
        if (m * base >= x) return m * base;
    }
    return 10 * base;
}

function verdict(total: number, base: number, p: number): string {
    if (total < base * 20) {
        return 'Todavía son pocos símbolos para sacar conclusiones.';
    }
    const odds = fmtPercent(p);
    if (p < 0.01) {
        return `Desequilibrio poco común: el puro azar lo produciría ${p < 0.001 ? `menos del 0,1${THIN}%` : `solo el ${odds}`} de las veces. Si persiste con más dígitos, sería notable.`;
    }
    if (p < 0.05) {
        return `Desequilibrio algo alto: el azar lo produciría el ${odds} de las veces. Pasa de vez en cuando; mira cómo evoluciona.`;
    }
    return `Compatible con el azar: un dado perfecto de ${base} caras mostraría diferencias así o mayores el ${odds} de las veces.`;
}
