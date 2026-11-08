/**
 * Constelaciones: los decimales de π se leen por grupos y cada grupo es una
 * constelación en un cielo de 1 × 1.
 *
 *   1 dígito          cuántas estrellas tiene: 3 + d mod 5 (de 3 a 7)
 *   6 dígitos         dónde está la primera: x = 0,ddd · y = 0,ddd
 *   por estrella      su brillo (0 = tenue … 9 = brillante)
 *   por cada otra     2 dígitos más: cuánto se aleja de la anterior en x e y
 *
 * Un grupo de s estrellas usa 3·s + 5 decimales (de 14 a 26). Las líneas
 * unen las estrellas por su árbol de distancias mínimas, como se dibujan
 * las constelaciones de verdad: cada estrella con su vecina más cercana,
 * sin cerrar ciclos.
 */
import type { DigitStore } from './store';

export const MIN_STARS = 3;
export const MAX_STARS = 7;
/** Separación entre estrellas vecinas por cada unidad de dígito. */
export const SPREAD = 0.016;

/** Decimales que usa una constelación de `stars` estrellas. */
export function groupLength(stars: number): number {
    return 3 * stars + 5;
}

export class Sky {
    xs = new Float32Array(1024);
    ys = new Float32Array(1024);
    /** Brillo de cada estrella (0–9). */
    mags = new Uint8Array(1024);
    stars = 0;
    /** Primera estrella de cada constelación (y una más al final). */
    starts = new Int32Array(256);
    groups = 0;
    /** Líneas: pares de índices de estrella. */
    edges = new Int32Array(2048);
    edgeCount = 0;
    /** Primera línea de cada constelación (y una más al final). */
    edgeStarts = new Int32Array(256);
    /** Decimales ya leídos. */
    consumed = 0;
    private readonly scratch = new Uint8Array(groupLength(MAX_STARS));

    /** Lee las constelaciones completas que hayan llegado. */
    extend(store: DigitStore): number {
        let added = 0;
        while (this.consumed < store.length) {
            const stars = MIN_STARS + (store.at(this.consumed) % 5);
            const need = groupLength(stars);
            if (this.consumed + need > store.length) break;
            store.read(
                this.consumed,
                this.consumed + need,
                this.scratch,
            );
            this.addGroup(stars, this.scratch);
            this.consumed += need;
            added++;
        }
        return added;
    }

    private addGroup(count: number, d: Uint8Array): void {
        this.reserve(count);
        const first = this.stars;
        let x = (d[1] * 100 + d[2] * 10 + d[3] + 0.5) / 1000;
        let y = (d[4] * 100 + d[5] * 10 + d[6] + 0.5) / 1000;
        let at = 7;
        for (let j = 0; j < count; j++) {
            if (j > 0) {
                x = reflect(x + (d[at++] - 4.5) * SPREAD);
                y = reflect(y + (d[at++] - 4.5) * SPREAD);
            }
            this.xs[this.stars] = x;
            this.ys[this.stars] = y;
            this.mags[this.stars] = d[at++];
            this.stars++;
        }

        // Árbol de distancias mínimas (Prim; como mucho 7 estrellas).
        this.edgeStarts[this.groups] = this.edgeCount;
        const inTree = [
            true,
            ...new Array<boolean>(count - 1).fill(false),
        ];
        for (let added = 1; added < count; added++) {
            let best = Infinity;
            let from = 0;
            let to = 0;
            for (let a = 0; a < count; a++) {
                if (!inTree[a]) continue;
                for (let b = 0; b < count; b++) {
                    if (inTree[b]) continue;
                    const dx =
                        this.xs[first + a] - this.xs[first + b];
                    const dy =
                        this.ys[first + a] - this.ys[first + b];
                    const dist = dx * dx + dy * dy;
                    if (dist < best) {
                        best = dist;
                        from = a;
                        to = b;
                    }
                }
            }
            inTree[to] = true;
            this.edges[this.edgeCount * 2] = first + from;
            this.edges[this.edgeCount * 2 + 1] = first + to;
            this.edgeCount++;
        }

        this.starts[this.groups] = first;
        this.groups++;
        this.starts[this.groups] = this.stars;
        this.edgeStarts[this.groups] = this.edgeCount;
    }

    private reserve(count: number): void {
        if (this.stars + count > this.xs.length) {
            const cap = Math.max(
                this.xs.length * 2,
                this.stars + count,
            );
            this.xs = grow(this.xs, cap);
            this.ys = grow(this.ys, cap);
            this.mags = grow(this.mags, cap);
            this.edges = grow(this.edges, cap * 2);
        }
        if (this.groups + 2 > this.starts.length) {
            const cap = this.starts.length * 2;
            this.starts = grow(this.starts, cap);
            this.edgeStarts = grow(this.edgeStarts, cap);
        }
    }
}

/** Rebota en los bordes para quedarse dentro de [0, 1]. */
function reflect(v: number): number {
    if (v < 0) return -v;
    if (v > 1) return 2 - v;
    return v;
}

function grow<T extends Float32Array | Uint8Array | Int32Array>(
    a: T,
    cap: number,
): T {
    const b = new (a.constructor as new (n: number) => T)(cap);
    b.set(a);
    return b;
}
