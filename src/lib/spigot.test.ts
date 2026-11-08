import { describe, expect, it } from 'vitest';
import { symbolsToString } from './alphabet';
import { PiSpigot, piDigits } from './spigot';

const PI_100 =
    '1415926535897932384626433832795028841971' +
    '6939937510582097494459230781640628620899' +
    '86280348253421170679';

const PI_HEX_40 = '243F6A8885A308D313198A2E03707344A4093822';

/** Dígitos fraccionarios en base `to` a partir de dígitos en base `from`. */
function convert(
    digits: string,
    from: number,
    to: number,
    count: number,
): string {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let num = 0n;
    for (const ch of digits)
        num = num * BigInt(from) + BigInt(alphabet.indexOf(ch));
    const den = BigInt(from) ** BigInt(digits.length);
    let out = '';
    for (let i = 0; i < count; i++) {
        num *= BigInt(to);
        out += alphabet[Number(num / den)];
        num %= den;
    }
    return out;
}

describe('PiSpigot', () => {
    it('emite la parte entera primero', () => {
        for (const base of [2, 4, 10, 16, 26]) {
            expect(new PiSpigot(base).next()).toBe(3);
        }
    });

    it('base 10: los primeros 100 decimales', () => {
        const { integer, digits } = piDigits(10, 100);
        expect(integer).toBe(3);
        expect(symbolsToString(digits, 10)).toBe(PI_100);
    });

    it('base 16: 3.243F6A8885A308D313198A2E…', () => {
        const { digits } = piDigits(16, PI_HEX_40.length);
        expect(symbolsToString(digits, 16)).toBe(PI_HEX_40);
    });

    it('base 2 y base 4 coinciden con la expansión hexadecimal', () => {
        const bin = piDigits(2, 120).digits.join('');
        expect(bin).toBe(convert(PI_HEX_40, 16, 2, 120));
        const quad = piDigits(4, 60).digits.join('');
        expect(quad).toBe(convert(PI_HEX_40, 16, 4, 60));
    });

    it('base 26 coincide con la conversión de los decimales conocidos', () => {
        // 100 decimales dan ~70 dígitos en base 26; usamos 60 con margen.
        const expected = convert(PI_100, 10, 26, 60);
        const { digits } = piDigits(26, 60);
        expect(
            Array.from(
                digits,
                (d) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[d],
            ).join(''),
        ).toBe(expected);
    });

    it('rechaza bases inválidas', () => {
        expect(() => new PiSpigot(1)).toThrow(RangeError);
        expect(() => new PiSpigot(2.5)).toThrow(RangeError);
    });
});
