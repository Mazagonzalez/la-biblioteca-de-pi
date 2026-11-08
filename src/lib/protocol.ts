/** Mensajes entre el hilo principal y el worker de π. */

export type ToWorker =
    /** Activa el flujo de esa base (lo crea o lo carga) y pausa el resto. */
    | { type: 'setBase'; base: number }
    | { type: 'pause' }
    | { type: 'resume' }
    /** Guarda ya el progreso (p. ej. al ocultar o cerrar la página). */
    | { type: 'flush' }
    /** Borra todo lo guardado y se detiene. */
    | { type: 'reset' };

export interface BatchMessage {
    type: 'batch';
    base: number;
    /** Índice global (0 = primer dígito fraccionario) del primer dígito. */
    start: number;
    digits: Uint8Array;
    /** Parte entera de π (siempre 3, escrita luego en la base). */
    integerPart: number;
    /** Tiempo de cálculo acumulado de este flujo, en ms (sin pausas). */
    computeMs: number;
    /** El lote viene de lo guardado en este navegador, no recién calculado. */
    restored?: boolean;
}

export type FromWorker =
    | BatchMessage
    | { type: 'reset-done' }
    /** Si la persistencia funciona en este navegador. */
    | { type: 'storage'; available: boolean };
