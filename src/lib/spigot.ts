/**
 * Spigot de Gibbons para π, genérico en cualquier base.
 *
 * Gibbons (2006), "Unbounded Spigot Algorithms for the Digits of Pi".
 * El estado es una transformación lineal fraccionaria
 *
 *     z(x) = (q·x + r) / t
 *
 * que se compone con los términos x_k = (k·x + 4k + 2) / (2k + 1) de la
 * serie de Euler. El candidato es n = ⌊z(3)⌋ = ⌊(3q + r) / t⌋ y es seguro
 * si también n = ⌊z(4)⌋ = ⌊(4q + r) / t⌋. Entonces se emite y el estado se
 * desplaza: r ← b·(r − n·t), q ← b·q.
 *
 * El primer valor emitido es la parte entera (3); los siguientes son los
 * dígitos fraccionarios en la base pedida.
 *
 * Dos optimizaciones que no cambian el resultado:
 *
 * 1. La división BigInt es ~50 veces más cara que multiplicar por un
 *    número pequeño. Para decidir si un dígito es seguro basta con los
 *    ~60 bits altos de q, r y t (desplazar a la derecha es casi gratis):
 *    se calculan z(3) y z(4) en coma flotante y solo se recurre a la
 *    división exacta si alguno queda a menos de 1e-9 de un entero.
 * 2. Los términos x_k se componen de `group` en `group` en una matriz
 *    pequeña antes de aplicarlos al estado grande (la composición de
 *    transformaciones es asociativa, así que el estado es el mismo).
 */
/** Estado serializable del spigot (BigInt como texto hexadecimal). */
export interface SpigotSnapshot {
    base: number;
    q: string;
    r: string;
    t: string;
    k: number;
    log2t: number;
}

const toHex = (n: bigint): string =>
    n < 0n ? `-${(-n).toString(16)}` : n.toString(16);

const fromHex = (s: string): bigint =>
    s.startsWith('-') ? -BigInt(`0x${s.slice(1)}`) : BigInt(`0x${s}`);

export class PiSpigot {
    readonly base: number;
    private readonly b: bigint;
    private readonly group: number;
    private q = 1n;
    private r = 0n;
    private t = 1n;
    private k = 0;
    /** log₂(t) aproximado, para elegir cuántos bits descartar. */
    private log2t = 0;

    constructor(base: number) {
        if (!Number.isInteger(base) || base < 2 || base > 256) {
            throw new RangeError(
                `La base debe ser un entero entre 2 y 256 (recibí ${base})`,
            );
        }
        this.base = base;
        this.b = BigInt(base);
        // Cada término aporta ~1 bit; un dígito en base b necesita ~log₂ b.
        this.group = Math.max(1, Math.ceil(Math.log2(base)));
    }

    /** Copia del estado para guardarla y retomar el cálculo más tarde. */
    snapshot(): SpigotSnapshot {
        return {
            base: this.base,
            q: toHex(this.q),
            r: toHex(this.r),
            t: toHex(this.t),
            k: this.k,
            log2t: this.log2t,
        };
    }

    /** Spigot que continúa exactamente donde se tomó el snapshot. */
    static restore(snap: SpigotSnapshot): PiSpigot {
        const spigot = new PiSpigot(snap.base);
        spigot.q = fromHex(snap.q);
        spigot.r = fromHex(snap.r);
        spigot.t = fromHex(snap.t);
        spigot.k = snap.k;
        spigot.log2t = snap.log2t;
        return spigot;
    }

    /** Siguiente valor del flujo (el primero es la parte entera). */
    next(): number {
        for (;;) {
            const n = this.safeDigit();
            if (n >= 0) {
                const { q, r, t, b } = this;
                this.r = b * (r - BigInt(n) * t);
                this.q = b * q;
                return n;
            }
            this.absorb();
        }
    }

    /** Dígito seguro, o −1 si todavía no lo hay. */
    private safeDigit(): number {
        const { q, r, t } = this;
        const shift = Math.max(0, Math.floor(this.log2t) - 60);
        let x3: number;
        let x4: number;
        if (shift === 0) {
            const tt = Number(t);
            const qq = Number(q);
            const rr = Number(r);
            x3 = (3 * qq + rr) / tt;
            x4 = (4 * qq + rr) / tt;
        } else {
            const s = BigInt(shift);
            const tt = Number(t >> s);
            const qq = Number(q >> s);
            const rr = Number(r >> s);
            x3 = (3 * qq + rr) / tt;
            x4 = (4 * qq + rr) / tt;
        }

        const EPS = 1e-9;
        const n3 = Math.floor(x3);
        const n4 = Math.floor(x4);
        const clear =
            n3 === Math.floor(x3 - EPS) &&
            n3 === Math.floor(x3 + EPS) &&
            n4 === Math.floor(x4 - EPS) &&
            n4 === Math.floor(x4 + EPS);
        if (clear) return n3 === n4 ? n3 : -1;

        // Caso límite: comprobación exacta con BigInt.
        const a = 3n * q + r;
        const n = a / t;
        // ⌊(4q + r) / t⌋ = n  ⇔  (a − n·t) + q < t
        return a - n * t + q < t ? Number(n) : -1;
    }

    /** Compone los siguientes `group` términos de la serie con el estado. */
    private absorb(): void {
        // M = x_{k+1} ∘ x_{k+2} ∘ … con x_j = (j, 4j + 2; 0, 2j + 1)
        let mq = 1n;
        let mr = 0n;
        let mt = 1n;
        for (let i = 0; i < this.group; i++) {
            const k = ++this.k;
            const l = 2 * k + 1;
            const bk = BigInt(k);
            const bl = BigInt(l);
            mr = mq * BigInt(2 * l) + mr * bl;
            mq *= bk;
            mt *= bl;
            this.log2t += Math.log2(l);
        }
        const { q, r, t } = this;
        this.q = q * mq;
        this.r = q * mr + r * mt;
        this.t = t * mt;
    }
}

/** Parte entera y los primeros `count` dígitos fraccionarios de π. */
export function piDigits(
    base: number,
    count: number,
): { integer: number; digits: Uint8Array } {
    const spigot = new PiSpigot(base);
    const integer = spigot.next();
    const digits = new Uint8Array(count);
    for (let i = 0; i < count; i++) digits[i] = spigot.next();
    return { integer, digits };
}
