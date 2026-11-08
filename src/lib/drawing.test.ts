import { describe, expect, it } from 'vitest';
import {
    arcEnd,
    arcStart,
    fitRadius,
    foldAngle,
    threadAngle,
    Walk10,
} from './drawing';
import { DigitStore } from './store';

describe('hilos', () => {
    it('cada punto cae dentro del arco de su dígito', () => {
        for (let d = 0; d < 10; d++) {
            for (let i = 0; i < 500; i++) {
                const a = threadAngle(d, i);
                expect(a).toBeGreaterThanOrEqual(arcStart(d) - 1e-12);
                expect(a).toBeLessThanOrEqual(arcEnd(d) + 1e-12);
            }
        }
    });

    it('los arcos no se tocan y dan la vuelta completa', () => {
        for (let d = 0; d < 9; d++) {
            expect(arcEnd(d)).toBeLessThan(arcStart(d + 1));
        }
        expect(arcEnd(9) - arcStart(0)).toBeLessThan(Math.PI * 2);
    });
});

describe('mandala', () => {
    it('foldAngle deja todo en la cuña y es simétrico', () => {
        const s = 6;
        const wedge = Math.PI / s;
        for (let k = -50; k <= 50; k++) {
            const t = k * 0.173;
            const f = foldAngle(t, s);
            expect(f).toBeGreaterThanOrEqual(0);
            expect(f).toBeLessThanOrEqual(wedge + 1e-12);
            // Espejo y giro de 2π/S dan el mismo punto doblado.
            expect(foldAngle(-t, s)).toBeCloseTo(f, 10);
            expect(foldAngle(t + 2 * wedge, s)).toBeCloseTo(f, 10);
        }
    });

    it('la caminata da pasos de largo 1 en la dirección del dígito', () => {
        const store = new DigitStore();
        store.append(Uint8Array.of(1, 4, 1, 5, 9, 2, 6, 5, 3, 5));
        const walk = new Walk10();
        expect(walk.extend(store)).toBe(10);
        expect(walk.steps).toBe(10);
        for (let i = 1; i < walk.length; i++) {
            const dx = walk.xs[i] - walk.xs[i - 1];
            const dy = walk.ys[i] - walk.ys[i - 1];
            expect(Math.hypot(dx, dy)).toBeCloseTo(1, 5);
        }
        // El 5 apunta hacia abajo (180°).
        expect(walk.ys[4] - walk.ys[3]).toBeCloseTo(1, 5);
        // Seguir extendiendo solo añade lo nuevo.
        store.append(Uint8Array.of(8, 9, 7));
        expect(walk.extend(store)).toBe(3);
        expect(walk.length).toBe(14);
        expect(walk.maxR).toBeGreaterThan(0);
    });
});

describe('fitRadius', () => {
    it('sin cajas usa todo el espacio menos el margen', () => {
        expect(fitRadius(800, 600, 20, [], 10)).toBe(280);
    });

    it('se achica para no pisar una caja en la esquina', () => {
        const box = { left: 0, top: 0, right: 200, bottom: 100 };
        const r = fitRadius(800, 600, 20, [box], 10);
        // Distancia del centro (400, 300) a la esquina (200, 100).
        expect(r).toBeCloseTo(Math.hypot(200, 200) - 10, 6);
    });

    it('no baja del mínimo ni hace caso a cajas vacías', () => {
        const big = { left: 0, top: 0, right: 800, bottom: 600 };
        expect(fitRadius(800, 600, 20, [big], 10)).toBe(280 * 0.6);
        const empty = { left: 0, top: 0, right: 0, bottom: 0 };
        expect(fitRadius(800, 600, 20, [empty], 10)).toBe(280);
    });
});
