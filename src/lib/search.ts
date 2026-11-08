import type { DigitStore } from './store';

export const MAX_QUERY = 24;

export interface ParsedQuery {
    base: 10 | 26;
    symbols: Uint8Array;
    /** Texto normalizado tal como se busca (p. ej. "12051990", "CARLOS"). */
    text: string;
}

export type QueryResult =
    { ok: true; query: ParsedQuery } | { ok: false; error: string };

/**
 * Interpreta lo que escribe la persona:
 *  - solo cifras (se ignoran espacios, puntos, guiones y barras) → base 10,
 *    p. ej. una fecha "12/05/1990" → 12051990;
 *  - solo letras (sin tildes ni espacios) → base 26 con A = 0 … Z = 25.
 */
export function parseQuery(input: string): QueryResult | null {
    const plain = input
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[\s.\-/_:,'’]/g, '');
    if (!plain) return null;
    if (plain.length > MAX_QUERY) {
        return {
            ok: false,
            error: `Máximo ${MAX_QUERY} símbolos.`,
        };
    }
    if (/^[0-9]+$/.test(plain)) {
        const symbols = Uint8Array.from(
            plain,
            (c) => c.charCodeAt(0) - 48,
        );
        return {
            ok: true,
            query: { base: 10, symbols, text: plain },
        };
    }
    if (/^[A-Z]+$/.test(plain)) {
        const symbols = Uint8Array.from(
            plain,
            (c) => c.charCodeAt(0) - 65,
        );
        return {
            ok: true,
            query: { base: 26, symbols, text: plain },
        };
    }
    return {
        ok: false,
        error: 'Usa solo cifras (base 10) o solo letras A–Z (base 26).',
    };
}

/**
 * Búsqueda incremental con Knuth–Morris–Pratt. El estado del autómata se
 * conserva entre llamadas, así que una coincidencia que cruza el borde
 * entre dos lotes se detecta igual, y nada se revisa dos veces.
 */
export class IncrementalSearch {
    readonly pattern: Uint8Array;
    /** Posición (índice 0) donde empieza la primera coincidencia, o −1. */
    found = -1;
    /** Cuántos símbolos se han revisado ya. */
    scanned = 0;

    private readonly fail: Int32Array;
    private state = 0;

    constructor(pattern: Uint8Array) {
        if (pattern.length === 0)
            throw new RangeError('Patrón vacío');
        this.pattern = pattern;
        this.fail = buildFailure(pattern);
    }

    /** Revisa un trozo contiguo que empieza en `offset` (= scanned). */
    feed(view: Uint8Array, offset: number): boolean {
        if (this.found >= 0) return true;
        const p = this.pattern;
        const m = p.length;
        const fail = this.fail;
        let state = this.state;
        for (let i = 0; i < view.length; i++) {
            const x = view[i];
            while (state > 0 && p[state] !== x)
                state = fail[state - 1];
            if (p[state] === x) state++;
            if (state === m) {
                this.found = offset + i - m + 1;
                this.scanned = offset + i + 1;
                this.state = state;
                return true;
            }
        }
        this.state = state;
        this.scanned = offset + view.length;
        return false;
    }

    /**
     * Avanza sobre el almacén hasta encontrarla, agotar lo calculado o
     * pasar `deadline` (performance.now()). Devuelve true si la encontró.
     */
    advance(store: DigitStore, deadline: number): boolean {
        const SLICE = 1 << 16;
        while (this.found < 0 && this.scanned < store.length) {
            const end = Math.min(store.length, this.scanned + SLICE);
            store.forEachRange(this.scanned, end, (view, offset) => {
                if (this.found < 0) this.feed(view, offset);
            });
            if (performance.now() > deadline) break;
        }
        return this.found >= 0;
    }

    get done(): boolean {
        return this.found >= 0;
    }
}

function buildFailure(p: Uint8Array): Int32Array {
    const fail = new Int32Array(p.length);
    let k = 0;
    for (let i = 1; i < p.length; i++) {
        while (k > 0 && p[i] !== p[k]) k = fail[k - 1];
        if (p[i] === p[k]) k++;
        fail[i] = k;
    }
    return fail;
}

/**
 * Posición típica de la primera aparición de una secuencia de `length`
 * símbolos en base `base` si los dígitos son aleatorios: ~ base^length.
 */
export function expectedPosition(
    base: number,
    length: number,
): number {
    return base ** length;
}
