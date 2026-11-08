/**
 * El Mandala del modo Dibujo como SVG, sin canvas ni DOM, para la imagen
 * de compartir (og.png), que se genera al compilar.
 *
 * Misma idea que `renderers/mandala-canvas.ts`: la caminata de 10
 * direcciones de π se dobla dentro de una cuña de π/S radianes y la cuña
 * se repite 2·S veces (giros y espejos). El color va por anillos, del
 * centro (índigo) al borde (oro).
 */
import { foldAngle, STEP10_X, STEP10_Y } from './drawing';
import { timeBuckets } from './renderers/gradient';

const BUCKETS = 48;
/** Segmentos por trazo: los trazos se superponen y así los cruces brillan. */
const FLUSH = 160;

export interface MandalaSvgOptions {
    cx: number;
    cy: number;
    radius: number;
    symmetry: number;
}

const f = (n: number): string => n.toFixed(1);

/** Grupo SVG (`<g>…</g>`) con el mandala de los dígitos dados. */
export function mandalaSvg(
    digits: Uint8Array,
    { cx, cy, radius, symmetry }: MandalaSvgOptions,
): string {
    const n = digits.length;
    const xs = new Float64Array(n + 1);
    const ys = new Float64Array(n + 1);
    let maxR = 1;
    for (let i = 0; i < n; i++) {
        const d = digits[i];
        xs[i + 1] = xs[i] + STEP10_X[d];
        ys[i + 1] = ys[i] + STEP10_Y[d];
        maxR = Math.max(maxR, Math.hypot(xs[i + 1], ys[i + 1]));
    }

    const k = radius / maxR;
    const colors = timeBuckets(BUCKETS);
    const paths: string[] = [];
    const open: { d: string; count: number; x: number; y: number }[] =
        Array.from({ length: BUCKETS }, () => ({
            d: '',
            count: 0,
            x: NaN,
            y: NaN,
        }));
    const flush = (b: number): void => {
        const p = open[b];
        if (!p.d) return;
        paths.push(`<path stroke="${colors[b]}" d="${p.d}"/>`);
        p.d = '';
        p.count = 0;
        p.x = NaN;
    };

    let px = 0;
    let py = 0;
    for (let i = 0; i <= n; i++) {
        const r = Math.hypot(xs[i], ys[i]) * k;
        const t = foldAngle(Math.atan2(ys[i], xs[i]), symmetry);
        const qx = r * Math.cos(t);
        const qy = r * Math.sin(t);
        if (i > 0) {
            const b = Math.min(
                BUCKETS - 1,
                Math.floor((r / radius) * BUCKETS),
            );
            const p = open[b];
            // Si el trazo sigue donde quedó, basta con una «L».
            if (p.x !== px || p.y !== py) p.d += `M${f(px)} ${f(py)}`;
            p.d += `L${f(qx)} ${f(qy)}`;
            p.x = qx;
            p.y = qy;
            if (++p.count >= FLUSH) flush(b);
        }
        px = qx;
        py = qy;
    }
    for (let b = 0; b < BUCKETS; b++) flush(b);

    // Cuanta más tinta cae en la cuña, más transparente el trazo.
    const width = 1.4;
    const wedgeArea = (Math.PI * radius ** 2) / (2 * symmetry);
    const ink = (n * k * width) / wedgeArea;
    const alpha = Math.min(
        0.6,
        Math.max(0.12, 0.45 / Math.sqrt(ink)),
    );

    const copies: string[] = [];
    for (let m = 0; m < 2; m++) {
        for (let j = 0; j < symmetry; j++) {
            const angle = (j * 2 * Math.PI) / symmetry - Math.PI / 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const flip = m === 0 ? 1 : -1;
            const matrix = [cos, sin, -sin * flip, cos * flip, cx, cy]
                .map((v) => v.toFixed(4))
                .join(' ');
            copies.push(
                `<use href="#og-wedge" transform="matrix(${matrix})"/>`,
            );
        }
    }

    return (
        `<defs><g id="og-wedge" fill="none" stroke-width="${width}" ` +
        `stroke-opacity="${alpha.toFixed(3)}" stroke-linecap="round" ` +
        `stroke-linejoin="round">${paths.join('')}</g></defs>` +
        `<g>${copies.join('')}</g>`
    );
}
