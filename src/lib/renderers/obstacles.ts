import type { Box } from '../drawing';

/**
 * Cajas de los elementos que flotan sobre `root` (textos, botones), en
 * coordenadas de `root`. Los ocultos miden 0 y se ignoran después.
 */
export function boxesWithin(
    root: HTMLElement,
    elements: readonly HTMLElement[],
): Box[] {
    const base = root.getBoundingClientRect();
    return elements.map((el) => {
        const r = el.getBoundingClientRect();
        return {
            left: r.left - base.left,
            top: r.top - base.top,
            right: r.right - base.left,
            bottom: r.bottom - base.top,
        };
    });
}
