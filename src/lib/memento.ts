/**
 * «Tu recuerdo»: el decimal de π por el que iba el cálculo la primera vez
 * que este navegador abrió la página. Se guarda en localStorage y no
 * cambia nunca (salvo que se borren los datos del sitio).
 */

const KEY = 'pi-infinito:recuerdo';

export interface Memento {
    v: 1;
    /** Posición del decimal (1 = el primer decimal, el «1» de 3,1415…). */
    position: number;
    /** El dígito en esa posición. */
    digit: number;
    /** Cuándo llegó (ms desde 1970). */
    at: number;
    /** Si era el π global (todos ven el mismo) o el de este navegador. */
    global: boolean;
}

/** Lo que se lee de localStorage, validado; null si no hay o no sirve. */
export function parseMemento(raw: string | null): Memento | null {
    if (!raw) return null;
    try {
        const m = JSON.parse(raw) as Partial<Memento>;
        if (
            m.v !== 1 ||
            !Number.isInteger(m.position) ||
            (m.position ?? 0) < 1 ||
            !Number.isInteger(m.digit) ||
            (m.digit ?? -1) < 0 ||
            (m.digit ?? 10) > 9 ||
            typeof m.at !== 'number' ||
            typeof m.global !== 'boolean'
        )
            return null;
        return m as Memento;
    } catch {
        return null;
    }
}

export function loadMemento(): Memento | null {
    try {
        return parseMemento(localStorage.getItem(KEY));
    } catch {
        return null;
    }
}

/** Guarda el recuerdo; devuelve false si el navegador no deja guardar. */
export function saveMemento(m: Memento): boolean {
    try {
        localStorage.setItem(KEY, JSON.stringify(m));
        return true;
    } catch {
        return false;
    }
}

/**
 * El recuerdo para un flujo de base 10 con `length` decimales, cuyo último
 * dígito es `last`.
 */
export function mementoAt(
    length: number,
    last: number,
    global: boolean,
    now = Date.now(),
): Memento {
    return { v: 1, position: length, digit: last, at: now, global };
}
