/**
 * Geometría de los dibujos (sin canvas, para poder probarla).
 *
 * Hilos: los dígitos 0–9 se reparten en 10 arcos alrededor de un círculo y
 * un hilo une cada dígito con el siguiente. Dentro de su arco, el punto del
 * dígito i cae en frac(i·φ): una sucesión que reparte los puntos de forma
 * pareja sin depender de cuántos haya, así el dibujo se puede ir añadiendo.
 *
 * Mandala: π en base 10 como caminata de 10 direcciones (una cada 36°),
 * doblada como en un caleidoscopio: cada punto se refleja dentro de una
 * cuña de π/S radianes y luego la cuña se repite 2·S veces.
 */
import type { DigitStore } from './store';

const PHI_FRAC = 0.6180339887498949;
const TAU = Math.PI * 2;
/** Hueco entre arcos, como fracción del arco de cada dígito. */
export const ARC_GAP = 0.14;

/** Ángulo (radianes, 0 = arriba, sentido horario) del arco del dígito. */
export function arcStart(digit: number): number {
    return -Math.PI / 2 + ((digit + ARC_GAP / 2) * TAU) / 10;
}

export function arcEnd(digit: number): number {
    return -Math.PI / 2 + ((digit + 1 - ARC_GAP / 2) * TAU) / 10;
}

/** Ángulo del punto del dígito en la posición `index` de π. */
export function threadAngle(digit: number, index: number): number {
    const f = (index * PHI_FRAC) % 1;
    return (
        -Math.PI / 2 +
        ((digit + ARC_GAP / 2 + f * (1 - ARC_GAP)) * TAU) / 10
    );
}

/** Refleja un ángulo dentro de la cuña [0, π/S]. */
export function foldAngle(theta: number, symmetry: number): number {
    const wedge = Math.PI / symmetry;
    let t = theta % (2 * wedge);
    if (t < 0) t += 2 * wedge;
    return t > wedge ? 2 * wedge - t : t;
}

/** Paso de la caminata de 10 direcciones: 0 = arriba, luego cada 36°. */
export const STEP10_X = Array.from({ length: 10 }, (_, d) =>
    Math.sin((d * TAU) / 10),
);
export const STEP10_Y = Array.from(
    { length: 10 },
    (_, d) => -Math.cos((d * TAU) / 10),
);

/** Caminata de 10 direcciones en Float32Array que crecen al doble. */
export class Walk10 {
    xs = new Float32Array(1 << 14);
    ys = new Float32Array(1 << 14);
    /** Número de puntos (= pasos + 1); el 0 es el origen. */
    length = 1;
    /** Distancia máxima al origen alcanzada. */
    maxR = 0;
    private x = 0;
    private y = 0;

    get steps(): number {
        return this.length - 1;
    }

    extend(store: DigitStore): number {
        const from = this.steps;
        const to = store.length;
        if (to <= from) return 0;
        this.reserve(to + 1);
        const { xs, ys } = this;
        let n = this.length;
        let { x, y, maxR } = this;
        let maxR2 = maxR * maxR;
        store.forEachRange(from, to, (view) => {
            for (let i = 0; i < view.length; i++) {
                const d = view[i];
                x += STEP10_X[d];
                y += STEP10_Y[d];
                xs[n] = x;
                ys[n] = y;
                n++;
                const r2 = x * x + y * y;
                if (r2 > maxR2) maxR2 = r2;
            }
        });
        maxR = Math.sqrt(maxR2);
        Object.assign(this, { x, y, maxR, length: n });
        return to - from;
    }

    private reserve(points: number): void {
        if (points <= this.xs.length) return;
        let cap = this.xs.length;
        while (cap < points) cap *= 2;
        const xs = new Float32Array(cap);
        const ys = new Float32Array(cap);
        xs.set(this.xs.subarray(0, this.length));
        ys.set(this.ys.subarray(0, this.length));
        this.xs = xs;
        this.ys = ys;
    }
}

export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * Radio del círculo centrado en (w/2, h/2) que no pisa ninguna de las
 * cajas (textos y botones encima del dibujo), dejando `pad` de aire.
 * Nunca baja de `minFraction` del radio máximo: en pantallas muy chicas
 * es mejor que se superpongan un poco a que el dibujo desaparezca.
 */
export function fitRadius(
    w: number,
    h: number,
    margin: number,
    boxes: readonly Box[],
    pad: number,
    minFraction = 0.6,
): number {
    const max = Math.max(8, Math.min(w, h) / 2 - margin);
    const cx = w / 2;
    const cy = h / 2;
    let r = max;
    for (const b of boxes) {
        if (b.right <= b.left || b.bottom <= b.top) continue;
        const dx = Math.max(b.left - cx, 0, cx - b.right);
        const dy = Math.max(b.top - cy, 0, cy - b.bottom);
        r = Math.min(r, Math.hypot(dx, dy) - pad);
    }
    return Math.max(max * minFraction, r);
}
