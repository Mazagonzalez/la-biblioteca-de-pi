import { describe, expect, it } from 'vitest';
import { mementoAt, parseMemento } from './memento';

describe('recuerdo', () => {
    it('ida y vuelta por JSON', () => {
        const m = mementoAt(84638, 7, true, 1_700_000_000_000);
        expect(parseMemento(JSON.stringify(m))).toEqual(m);
    });

    it('rechaza lo que no es un recuerdo válido', () => {
        expect(parseMemento(null)).toBeNull();
        expect(parseMemento('no es json')).toBeNull();
        expect(parseMemento('{}')).toBeNull();
        const ok = mementoAt(10, 3, false, 1);
        for (const bad of [
            { ...ok, v: 2 },
            { ...ok, position: 0 },
            { ...ok, position: 1.5 },
            { ...ok, digit: 10 },
            { ...ok, digit: -1 },
            { ...ok, at: '1' },
            { ...ok, global: 'sí' },
        ]) {
            expect(parseMemento(JSON.stringify(bad))).toBeNull();
        }
    });
});
