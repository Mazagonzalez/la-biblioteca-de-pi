import { describe, expect, it } from 'vitest';
import { DigitStore } from './store';
import { WalkPath } from './walk';

describe('WalkPath', () => {
    it('sigue las direcciones 0↑ 1→ 2↓ 3← y acumula límites', () => {
        const store = new DigitStore();
        const path = new WalkPath();
        store.append(Uint8Array.from([1, 1, 0, 3, 3, 3]));
        path.extend(store);
        store.append(Uint8Array.from([2, 2, 2]));
        path.extend(store);
        expect(path.steps).toBe(9);
        expect([path.xs[9], path.ys[9]]).toEqual([-1, 2]);
        expect([path.minX, path.maxX, path.minY, path.maxY]).toEqual([
            -1, 2, -1, 2,
        ]);
    });

    it('crece más allá de la capacidad inicial', () => {
        const store = new DigitStore();
        const path = new WalkPath();
        store.append(new Uint8Array(40_000).fill(1));
        path.extend(store);
        expect(path.length).toBe(40_001);
        expect(path.xs[40_000]).toBe(40_000);
    });
});
