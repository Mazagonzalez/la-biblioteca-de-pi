/** Bases que usa la aplicación. */
export type Base = 2 | 4 | 10 | 26;

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Símbolo de cada valor en la base dada. La base 26 usa letras
 * (A = 0 … Z = 25); el resto usa dígitos y luego letras.
 */
export function alphabetFor(base: number): string {
    if (base === 26) return LETTERS;
    if (base < 2 || base > DIGITS.length) {
        throw new RangeError(`Base sin alfabeto: ${base}`);
    }
    return DIGITS.slice(0, base);
}

/** Escribe un entero no negativo con el alfabeto de la base. */
export function formatInBase(value: number, base: number): string {
    const alphabet = alphabetFor(base);
    if (value === 0) return alphabet[0];
    let out = '';
    while (value > 0) {
        out = alphabet[value % base] + out;
        value = Math.floor(value / base);
    }
    return out;
}

/** Convierte una secuencia de valores a texto con el alfabeto de la base. */
export function symbolsToString(
    values: ArrayLike<number>,
    base: number,
): string {
    const alphabet = alphabetFor(base);
    let out = '';
    for (let i = 0; i < values.length; i++)
        out += alphabet[values[i]];
    return out;
}
