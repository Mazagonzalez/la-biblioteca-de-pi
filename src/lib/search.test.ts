import { describe, expect, it } from 'vitest';
import { IncrementalSearch, parseQuery } from './search';
import { piDigits } from './spigot';
import { DigitStore } from './store';

function q(input: string) {
    const r = parseQuery(input);
    if (!r || !r.ok) throw new Error('consulta inválida');
    return r.query;
}

describe('parseQuery', () => {
    it('fechas en base 10, ignorando separadores', () => {
        const query = q('12/05/1990');
        expect(query.base).toBe(10);
        expect(query.text).toBe('12051990');
        expect(Array.from(query.symbols)).toEqual([
            1, 2, 0, 5, 1, 9, 9, 0,
        ]);
    });

    it('nombres en base 26, sin tildes ni espacios', () => {
        const query = q('José Ñu');
        expect(query.base).toBe(26);
        expect(query.text).toBe('JOSENU');
        expect(query.symbols[0]).toBe(9); // J
    });

    it('rechaza mezclas y acepta vacío como null', () => {
        expect(parseQuery('abc123')).toMatchObject({ ok: false });
        expect(parseQuery('   ')).toBeNull();
    });
});

describe('IncrementalSearch', () => {
    const { digits } = piDigits(10, 1000);

    it('encuentra el punto de Feynman', () => {
        const store = new DigitStore();
        store.append(digits);
        const search = new IncrementalSearch(q('999999').symbols);
        expect(search.advance(store, Infinity)).toBe(true);
        expect(search.found + 1).toBe(762);
    });

    it('no pierde coincidencias que cruzan el borde entre lotes', () => {
        const pattern = q('999999').symbols;
        // Corta justo en medio de la racha (posiciones 762–767).
        for (const cut of [762, 763, 764, 765, 766]) {
            const search = new IncrementalSearch(pattern);
            expect(search.feed(digits.subarray(0, cut), 0)).toBe(
                false,
            );
            expect(search.feed(digits.subarray(cut), cut)).toBe(true);
            expect(search.found).toBe(761);
        }
    });

    it('sigue buscando a medida que crece el almacén', () => {
        const store = new DigitStore();
        const search = new IncrementalSearch(q('3421170679').symbols);
        for (let i = 0; i < 100; i += 7) {
            store.append(digits.subarray(i, Math.min(100, i + 7)));
            search.advance(store, Infinity);
            if (search.done) break;
        }
        expect(search.found + 1).toBe(91);
    });

    it('patrones con prefijos repetidos (KMP)', () => {
        const search = new IncrementalSearch(
            Uint8Array.from([1, 1, 2]),
        );
        search.feed(Uint8Array.from([1, 1, 1, 1]), 0);
        expect(search.feed(Uint8Array.from([2]), 4)).toBe(true);
        expect(search.found).toBe(2);
    });
});
