/** Mensajes entre el hilo principal y el worker de π. */

export type ToWorker =
    /** Activa el flujo de esa base (lo crea si no existe) y pausa el resto. */
    | { type: 'setBase'; base: number }
    | { type: 'pause' }
    | { type: 'resume' };

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
}

export type FromWorker = BatchMessage;
