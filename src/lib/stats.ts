export interface RunRecord {
    /** Valor del símbolo repetido. */
    symbol: number;
    /** Cuántas veces seguidas aparece. */
    length: number;
    /** Posición (1 = primer dígito tras la coma) donde empieza la racha. */
    position: number;
}

export interface ChiSquare {
    chi2: number;
    df: number;
    p: number;
}

/**
 * Estadísticas incrementales de un flujo de símbolos en base b:
 * frecuencias, χ² contra la distribución uniforme y rachas.
 */
export class SymbolStats {
    readonly base: number;
    readonly counts: Float64Array;
    total = 0;
    best: RunRecord = { symbol: -1, length: 0, position: 0 };

    private runSymbol = -1;
    private runLength = 0;
    private runStart = 0;

    constructor(base: number) {
        this.base = base;
        this.counts = new Float64Array(base);
    }

    /**
     * Añade un lote que empieza en el índice global `start` (0 = primer
     * dígito fraccionario). Devuelve el mejor récord nuevo del lote, si hubo.
     */
    push(digits: Uint8Array, start: number): RunRecord | null {
        const counts = this.counts;
        let symbol = this.runSymbol;
        let length = this.runLength;
        let runStart = this.runStart;
        let bestLength = this.best.length;
        let record: RunRecord | null = null;

        for (let i = 0; i < digits.length; i++) {
            const d = digits[i];
            counts[d]++;
            if (d === symbol) {
                length++;
            } else {
                symbol = d;
                length = 1;
                runStart = start + i;
            }
            if (length > bestLength) {
                bestLength = length;
                record = { symbol, length, position: runStart + 1 };
            }
        }

        this.runSymbol = symbol;
        this.runLength = length;
        this.runStart = runStart;
        this.total += digits.length;
        if (record) this.best = record;
        return record;
    }

    get currentRun(): RunRecord {
        return {
            symbol: this.runSymbol,
            length: this.runLength,
            position: this.runStart + 1,
        };
    }

    /** Frecuencia relativa de cada símbolo. */
    frequencies(): Float64Array {
        const out = new Float64Array(this.base);
        if (this.total === 0) return out;
        for (let i = 0; i < this.base; i++) {
            out[i] = this.counts[i] / this.total;
        }
        return out;
    }

    chiSquare(): ChiSquare {
        const df = this.base - 1;
        if (this.total === 0) return { chi2: 0, df, p: 1 };
        const expected = this.total / this.base;
        let chi2 = 0;
        for (let i = 0; i < this.base; i++) {
            const diff = this.counts[i] - expected;
            chi2 += (diff * diff) / expected;
        }
        return { chi2, df, p: chiSquarePValue(chi2, df) };
    }
}

/** P(X ≥ chi2) para X ~ χ²(df). */
export function chiSquarePValue(chi2: number, df: number): number {
    if (chi2 <= 0) return 1;
    return gammaQ(df / 2, chi2 / 2);
}

// --- Función gamma incompleta regularizada (Numerical Recipes) ---------

const LANCZOS = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lnGamma(x: number): number {
    if (x < 0.5) {
        return (
            Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
        );
    }
    x -= 1;
    let a = 0.99999999999980993;
    const t = x + 7.5;
    for (let i = 0; i < LANCZOS.length; i++)
        a += LANCZOS[i] / (x + i + 1);
    return (
        0.5 * Math.log(2 * Math.PI) +
        (x + 0.5) * Math.log(t) -
        t +
        Math.log(a)
    );
}

const EPS = 1e-14;
const MAX_ITER = 500;

/** P(a, x) por serie; converge bien para x < a + 1. */
function gammaPSeries(a: number, x: number): number {
    let sum = 1 / a;
    let term = sum;
    let ap = a;
    for (let n = 0; n < MAX_ITER; n++) {
        ap += 1;
        term *= x / ap;
        sum += term;
        if (Math.abs(term) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Q(a, x) por fracción continua (Lentz); para x ≥ a + 1. */
function gammaQFraction(a: number, x: number): number {
    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < MAX_ITER; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < tiny) d = tiny;
        c = b + an / c;
        if (Math.abs(c) < tiny) c = tiny;
        d = 1 / d;
        const delta = d * c;
        h *= delta;
        if (Math.abs(delta - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Q(a, x) = Γ(a, x) / Γ(a), la gamma incompleta superior regularizada. */
export function gammaQ(a: number, x: number): number {
    if (x <= 0) return 1;
    if (x < a + 1) return 1 - gammaPSeries(a, x);
    return gammaQFraction(a, x);
}
