/** querySelector que falla con un mensaje claro si falta el elemento. */
export function $<T extends Element = HTMLElement>(
    root: ParentNode,
    selector: string,
): T {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`Falta el elemento ${selector}`);
    return el;
}
