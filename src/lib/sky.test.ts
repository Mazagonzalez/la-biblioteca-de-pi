import { describe, expect, it } from 'vitest';
import { piDigits } from './spigot';
import {
    groupLength,
    MAX_STARS,
    MIN_STARS,
    Sky,
    SPREAD,
} from './sky';
import { DigitStore } from './store';

const { digits } = piDigits(10, 8000);
const PI = Uint8Array.from(digits);

function storeOf(n: number): DigitStore {
    const store = new DigitStore();
    store.append(PI.subarray(0, n));
    return store;
}

describe('constelaciones', () => {
    it('lee la primera constelación de π tal como se describe', () => {
        // 1 415926 5 35 8 97 9 32 3 → 4 estrellas, 17 decimales.
        expect(groupLength(4)).toBe(17);
        const sky = new Sky();
        expect(sky.extend(storeOf(16))).toBe(0);
        expect(sky.extend(storeOf(17))).toBe(1);
        expect(sky.stars).toBe(4);
        expect(sky.xs[0]).toBeCloseTo(0.4155, 5);
        expect(sky.ys[0]).toBeCloseTo(0.9265, 5);
        expect(Array.from(sky.mags.subarray(0, 4))).toEqual([
            5, 8, 9, 3,
        ]);
        // Segunda estrella: dx = 3 − 4,5 y dy = 5 − 4,5 pasos.
        expect(sky.xs[1]).toBeCloseTo(0.4155 - 1.5 * SPREAD, 5);
        expect(sky.ys[1]).toBeCloseTo(0.9265 + 0.5 * SPREAD, 5);
        expect(sky.edgeCount).toBe(3);
    });

    it('cada constelación es un árbol dentro del cielo', () => {
        const sky = new Sky();
        sky.extend(storeOf(PI.length));
        // Suficientes para que crezcan los arreglos internos.
        expect(sky.groups).toBeGreaterThan(256);
        expect(sky.stars).toBeGreaterThan(1024);
        for (let g = 0; g < sky.groups; g++) {
            const n = sky.starts[g + 1] - sky.starts[g];
            expect(n).toBeGreaterThanOrEqual(MIN_STARS);
            expect(n).toBeLessThanOrEqual(MAX_STARS);
            expect(sky.edgeStarts[g + 1] - sky.edgeStarts[g]).toBe(
                n - 1,
            );
            // Cada línea une dos estrellas de la misma constelación.
            for (
                let e = sky.edgeStarts[g];
                e < sky.edgeStarts[g + 1];
                e++
            ) {
                for (const s of [
                    sky.edges[e * 2],
                    sky.edges[e * 2 + 1],
                ]) {
                    expect(s).toBeGreaterThanOrEqual(sky.starts[g]);
                    expect(s).toBeLessThan(sky.starts[g + 1]);
                }
            }
        }
        for (let i = 0; i < sky.stars; i++) {
            expect(sky.xs[i]).toBeGreaterThanOrEqual(0);
            expect(sky.xs[i]).toBeLessThanOrEqual(1);
            expect(sky.ys[i]).toBeGreaterThanOrEqual(0);
            expect(sky.ys[i]).toBeLessThanOrEqual(1);
        }
    });

    it('leer de a poco da el mismo cielo que leer de una vez', () => {
        const whole = new Sky();
        whole.extend(storeOf(PI.length));
        const bit = new Sky();
        const store = new DigitStore();
        for (let i = 0; i < PI.length; i += 37) {
            store.append(PI.subarray(i, Math.min(PI.length, i + 37)));
            bit.extend(store);
        }
        expect(bit.groups).toBe(whole.groups);
        expect(bit.consumed).toBe(whole.consumed);
        expect(Array.from(bit.xs.subarray(0, bit.stars))).toEqual(
            Array.from(whole.xs.subarray(0, whole.stars)),
        );
        expect(
            Array.from(bit.edges.subarray(0, bit.edgeCount * 2)),
        ).toEqual(
            Array.from(whole.edges.subarray(0, whole.edgeCount * 2)),
        );
    });
});
