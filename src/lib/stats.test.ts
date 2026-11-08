import { describe, expect, it } from 'vitest';
import { piDigits } from './spigot';
import { SymbolStats, chiSquarePValue } from './stats';
import { DigitStore } from './store';

describe('chiSquarePValue', () => {
    it('df = 2 tiene forma cerrada e^(−x/2)', () => {
        for (const x of [0.5, 2, 7, 15]) {
            expect(chiSquarePValue(x, 2)).toBeCloseTo(
                Math.exp(-x / 2),
                10,
            );
        }
    });

    it('valores críticos conocidos', () => {
        expect(chiSquarePValue(16.919, 9)).toBeCloseTo(0.05, 3);
        expect(chiSquarePValue(21.666, 9)).toBeCloseTo(0.01, 3);
        expect(chiSquarePValue(3.841, 1)).toBeCloseTo(0.05, 3);
        expect(chiSquarePValue(37.652, 25)).toBeCloseTo(0.05, 3);
    });
});

describe('SymbolStats', () => {
    it('encuentra el punto de Feynman aunque cruce lotes', () => {
        const { digits } = piDigits(10, 1000);
        const stats = new SymbolStats(10);
        // Cortes arbitrarios, uno en medio de la racha de nueves.
        stats.push(digits.subarray(0, 764), 0);
        stats.push(digits.subarray(764), 764);
        expect(stats.best).toEqual({
            symbol: 9,
            length: 6,
            position: 762,
        });
        expect(stats.total).toBe(1000);
        const sum = stats.counts.reduce((a, b) => a + b, 0);
        expect(sum).toBe(1000);
    });

    it('χ² de una distribución perfecta es 0 y p = 1', () => {
        const stats = new SymbolStats(4);
        stats.push(Uint8Array.from([0, 1, 2, 3, 3, 2, 1, 0]), 0);
        const { chi2, df, p } = stats.chiSquare();
        expect(chi2).toBe(0);
        expect(df).toBe(3);
        expect(p).toBe(1);
    });
});

describe('DigitStore', () => {
    it('lee rangos que cruzan trozos', () => {
        const store = new DigitStore();
        const n = (1 << 16) + 1000;
        const data = new Uint8Array(n).map((_, i) => i % 251);
        store.append(data.subarray(0, 5000));
        store.append(data.subarray(5000));
        expect(store.length).toBe(n);
        expect(store.at(65535)).toBe(65535 % 251);
        expect(store.at(65536)).toBe(65536 % 251);
        const out = new Uint8Array(200);
        expect(store.read(65500, 65700, out)).toBe(200);
        expect(Array.from(out)).toEqual(
            Array.from(data.subarray(65500, 65700)),
        );
    });
});
