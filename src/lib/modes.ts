import type { PiStream } from './engine';

export type ModeId =
    'digits' | 'letters' | 'color' | 'walk' | 'sound' | 'draw';

export interface ModeDef {
    id: ModeId;
    label: string;
    base: 4 | 10 | 26;
    /** Fragmento de URL (#digitos, #letras…). */
    hash: string;
    description: string;
}

export const MODES: readonly ModeDef[] = [
    {
        id: 'digits',
        label: 'Dígitos',
        base: 10,
        hash: 'digitos',
        description: 'Decimales de π en base 10',
    },
    {
        id: 'letters',
        label: 'Letras',
        base: 26,
        hash: 'letras',
        description: 'π en base 26: A = 0 … Z = 25',
    },
    {
        id: 'color',
        label: 'Color',
        base: 10,
        hash: 'color',
        description: 'Cada decimal es un píxel de color',
    },
    {
        id: 'walk',
        label: 'Caminata',
        base: 4,
        hash: 'caminata',
        description: 'π en base 4 como caminata aleatoria',
    },
    {
        id: 'sound',
        label: 'Sonido',
        base: 10,
        hash: 'sonido',
        description: 'Cada decimal es una nota pentatónica',
    },
    {
        id: 'draw',
        label: 'Dibujo',
        base: 10,
        hash: 'dibujo',
        description: 'Los decimales como instrucciones para dibujar',
    },
];

export function modeById(id: string): ModeDef | undefined {
    return MODES.find((m) => m.id === id);
}

export function modeByHash(hash: string): ModeDef | undefined {
    const h = hash.replace(/^#/, '');
    return MODES.find((m) => m.hash === h);
}

/** Lo que cada modo implementa para el controlador de la página. */
export interface ModeView {
    activate(stream: PiStream): void;
    deactivate(): void;
    /** Llegaron dígitos nuevos al flujo del modo. */
    update(stream: PiStream): void;
}
