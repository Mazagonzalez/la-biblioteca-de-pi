import type { DigitStore } from './store';

/** 0 ↑, 1 →, 2 ↓, 3 ← (y crece hacia abajo, como en pantalla). */
export const STEP_X = [0, 1, 0, -1] as const;
export const STEP_Y = [-1, 0, 1, 0] as const;

/**
 * Camino de la caminata aleatoria guardado en Int32Array que crecen al
 * doble. El punto 0 es el origen; el punto i es la posición tras i pasos.
 */
export class WalkPath {
    xs = new Int32Array(1 << 14);
    ys = new Int32Array(1 << 14);
    /** Número de puntos (= pasos + 1). */
    length = 1;
    minX = 0;
    maxX = 0;
    minY = 0;
    maxY = 0;

    get steps(): number {
        return this.length - 1;
    }

    /** Añade los pasos del almacén que aún no forman parte del camino. */
    extend(store: DigitStore): number {
        const from = this.steps;
        const to = store.length;
        if (to <= from) return 0;
        this.reserve(to + 1);
        const xs = this.xs;
        const ys = this.ys;
        let n = this.length;
        let x = xs[n - 1];
        let y = ys[n - 1];
        let { minX, maxX, minY, maxY } = this;
        store.forEachRange(from, to, (view) => {
            for (let i = 0; i < view.length; i++) {
                const d = view[i];
                x += STEP_X[d];
                y += STEP_Y[d];
                xs[n] = x;
                ys[n] = y;
                n++;
                if (x < minX) minX = x;
                else if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                else if (y > maxY) maxY = y;
            }
        });
        this.length = n;
        Object.assign(this, { minX, maxX, minY, maxY });
        return to - from;
    }

    private reserve(points: number): void {
        if (points <= this.xs.length) return;
        let cap = this.xs.length;
        while (cap < points) cap *= 2;
        const xs = new Int32Array(cap);
        const ys = new Int32Array(cap);
        xs.set(this.xs.subarray(0, this.length));
        ys.set(this.ys.subarray(0, this.length));
        this.xs = xs;
        this.ys = ys;
    }
}
