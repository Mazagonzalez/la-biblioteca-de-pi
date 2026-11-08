/** Espacio fino no separable: separa miles sin romper la línea. */
export const THIN = ' ';

/** 1234567 → "1 234 567" (con espacio fino). */
export function fmtInt(value: number): string {
    const s = Math.floor(value).toString();
    if (s.length <= 4) return s;
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Decimal con coma: fmtDecimal(0.6052, 3) → "0,605". */
export function fmtDecimal(value: number, digits: number): string {
    if (!Number.isFinite(value)) return '—';
    const [int, frac] = value.toFixed(digits).split('.');
    const grouped = fmtInt(Math.abs(Number(int)));
    const sign =
        value < 0 && Number(value.toFixed(digits)) !== 0 ? '−' : '';
    return frac ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/** Velocidad legible con cifras significativas razonables. */
export function fmtRate(rate: number): string {
    if (!Number.isFinite(rate) || rate <= 0) return '—';
    if (rate >= 100) return fmtInt(Math.round(rate));
    if (rate >= 10) return fmtDecimal(rate, 1);
    return fmtDecimal(rate, 2);
}

/** 83 000 ms → "1:23"; 3 723 000 ms → "1:02:03". */
export function fmtDuration(ms: number): string {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const ss = String(s).padStart(2, '0');
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
    return `${m}:${ss}`;
}

/** Probabilidad como porcentaje legible: 0.605 → "61 %". */
export function fmtPercent(p: number): string {
    const pct = p * 100;
    if (pct >= 10) return `${Math.round(pct)}${THIN}%`;
    if (pct >= 1) return `${fmtDecimal(pct, 1)}${THIN}%`;
    if (pct >= 0.1) return `${fmtDecimal(pct, 2)}${THIN}%`;
    return `<0,1${THIN}%`;
}

/** p-valor compacto: "0,605", "0,0021", "<0,0001". */
export function fmtP(p: number): string {
    if (!Number.isFinite(p)) return '—';
    if (p >= 0.01) return fmtDecimal(p, 3);
    if (p >= 0.0001) return fmtDecimal(p, 4);
    return '<0,0001';
}

const WORDS = [
    'cero',
    'uno',
    'dos',
    'tres',
    'cuatro',
    'cinco',
    'seis',
    'siete',
    'ocho',
    'nueve',
    'diez',
    'once',
    'doce',
    'trece',
    'catorce',
    'quince',
];

/** Número en palabras hasta 15; a partir de ahí, en cifras. */
export function numberWord(n: number): string {
    return WORDS[n] ?? fmtInt(n);
}
