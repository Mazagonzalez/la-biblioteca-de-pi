const FIRST_CHUNK = 1 << 16; // 64 KiB
const MAX_CHUNK = 1 << 22; // 4 MiB

/**
 * Almacén de dígitos en trozos de `Uint8Array` de tamaño creciente
 * (64 KiB, 128 KiB, … hasta 4 MiB). Evita un string gigante y evita
 * recopiar todo cada vez que crece.
 */
export class DigitStore {
    private chunks: Uint8Array[] = [];
    private offsets: number[] = [];
    private size = 0;

    get length(): number {
        return this.size;
    }

    append(src: Uint8Array): void {
        let i = 0;
        while (i < src.length) {
            let last = this.chunks.length - 1;
            let used = last < 0 ? 0 : this.size - this.offsets[last];
            if (last < 0 || used === this.chunks[last].length) {
                const capacity = Math.min(
                    MAX_CHUNK,
                    FIRST_CHUNK * 2 ** this.chunks.length,
                );
                this.chunks.push(new Uint8Array(capacity));
                this.offsets.push(this.size);
                last++;
                used = 0;
            }
            const chunk = this.chunks[last];
            const n = Math.min(chunk.length - used, src.length - i);
            chunk.set(src.subarray(i, i + n), used);
            i += n;
            this.size += n;
        }
    }

    /** Índice del trozo que contiene la posición `index`. */
    private locate(index: number): number {
        let lo = 0;
        let hi = this.offsets.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.offsets[mid] <= index) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    at(index: number): number {
        if (index < 0 || index >= this.size) return -1;
        const c = this.locate(index);
        return this.chunks[c][index - this.offsets[c]];
    }

    /**
     * Recorre [start, end) entregando vistas contiguas, sin copiar.
     * `offset` es la posición global del primer elemento de cada vista.
     */
    forEachRange(
        start: number,
        end: number,
        fn: (view: Uint8Array, offset: number) => void,
    ): void {
        start = Math.max(0, start);
        end = Math.min(end, this.size);
        if (start >= end) return;
        let c = this.locate(start);
        let pos = start;
        while (pos < end) {
            const base = this.offsets[c];
            const chunk = this.chunks[c];
            const from = pos - base;
            const to = Math.min(chunk.length, end - base);
            fn(chunk.subarray(from, to), pos);
            pos = base + to;
            c++;
        }
    }

    /** Copia [start, end) en `out` (desde 0) y devuelve cuántos copió. */
    read(start: number, end: number, out: Uint8Array): number {
        let n = 0;
        this.forEachRange(start, end, (view) => {
            out.set(view, n);
            n += view.length;
        });
        return n;
    }
}
