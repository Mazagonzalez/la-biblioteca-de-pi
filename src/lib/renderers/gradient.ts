/** Degradado del pasado (índigo) al presente (oro). */
const STOPS: [number, [number, number, number]][] = [
    [0, [52, 44, 110]],
    [0.35, [122, 74, 140]],
    [0.65, [194, 115, 106]],
    [0.88, [216, 176, 106]],
    [1, [246, 230, 196]],
];

/** Color del degradado en t ∈ [0, 1]. */
export function timeColor(t: number): string {
    for (let i = 1; i < STOPS.length; i++) {
        const [t1, c1] = STOPS[i];
        if (t <= t1) {
            const [t0, c0] = STOPS[i - 1];
            const u = (t - t0) / (t1 - t0);
            const c = c0.map((v, k) =>
                Math.round(v + (c1[k] - v) * u),
            );
            return `rgb(${c[0]} ${c[1]} ${c[2]})`;
        }
    }
    const c = STOPS[STOPS.length - 1][1];
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/** El degradado partido en `n` tramos de color fijo. */
export function timeBuckets(n: number): string[] {
    return Array.from({ length: n }, (_, i) =>
        timeColor((i + 0.5) / n),
    );
}
