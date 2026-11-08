/**
 * Paleta de 10 colores para los dígitos 0–9. Basada en la paleta «muted»
 * de Paul Tol, diseñada para distinguirse con los tipos de daltonismo más
 * comunes; el gris claro completa la décima. Se alternan claros y oscuros
 * para que dígitos consecutivos contrasten también en luminancia.
 */
export const DIGIT_PALETTE = [
    '#332288', // 0 índigo
    '#88ccee', // 1 cian
    '#117733', // 2 verde
    '#ddcc77', // 3 arena
    '#882255', // 4 vino
    '#44aa99', // 5 turquesa
    '#cc6677', // 6 rosa
    '#999933', // 7 oliva
    '#aa4499', // 8 púrpura
    '#dddddd', // 9 gris claro
] as const;

/**
 * Blanco y negro: un bit por decimal. 0–4 es negro y 5–9 blanco, así cada
 * píxel es una moneda al aire (si π es normal, mitad y mitad). Con figuras
 * pequeñas de pocos píxeles pasa como con las palabras: tarde o temprano
 * aparecen.
 */
export const BW_DARK = '#09090b';
export const BW_LIGHT = '#ede8df';
export const BW_PALETTE = Array.from({ length: 10 }, (_, d) =>
    d < 5 ? BW_DARK : BW_LIGHT,
);

/** La paleta como enteros RGBA listos para un Uint32Array de ImageData. */
export function paletteLut(colors: readonly string[]): Uint32Array {
    const lut = new Uint32Array(colors.length);
    const littleEndian =
        new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
    colors.forEach((hex, i) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        lut[i] = littleEndian
            ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0
            : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
    });
    return lut;
}
