/**
 * Persistencia local en IndexedDB: cada navegador guarda su progreso y lo
 * retoma al volver. Se usa desde el worker.
 *
 * - `state`  (clave: base)          → estado del spigot + cuántos dígitos.
 * - `chunks` (clave: [base, índice]) → dígitos en trozos de CHUNK.
 *
 * Estado y trozos se escriben en la misma transacción, así que lo guardado
 * siempre es coherente. Al cargar se valida igualmente (por ejemplo, si dos
 * pestañas escribieron a la vez) y, ante cualquier duda, se empieza de cero.
 */
import type { SpigotSnapshot } from './spigot';

export const CHUNK = 1 << 16;
const DB_NAME = 'pi-infinito';
const DB_VERSION = 1;
export const FORMAT = 1;

export interface SavedState {
    format: number;
    base: number;
    produced: number;
    computeMs: number;
    integerPart: number;
    spigot: SpigotSnapshot;
    savedAt: number;
}

export interface SavedStream {
    state: SavedState;
    digits: Uint8Array;
}

export interface ChunkWrite {
    index: number;
    data: Uint8Array;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

/** Abre la base de datos; null si IndexedDB no está disponible. */
export async function openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('state')) {
                db.createObjectStore('state');
            }
            if (!db.objectStoreNames.contains('chunks')) {
                db.createObjectStore('chunks');
            }
        };
        return await request(req);
    } catch {
        return null;
    }
}

export async function loadStream(
    db: IDBDatabase,
    base: number,
): Promise<SavedStream | null> {
    const tx = db.transaction(['state', 'chunks'], 'readonly');
    const state = (await request(
        tx.objectStore('state').get(base),
    )) as SavedState | undefined;
    if (!state || state.format !== FORMAT || state.base !== base) {
        return null;
    }
    const range = IDBKeyRange.bound([base, 0], [base, Infinity]);
    const chunks = (await request(
        tx.objectStore('chunks').getAll(range),
    )) as Uint8Array[];

    // Los trozos 0..n-2 deben estar llenos y sumar al menos `produced`.
    const needed = Math.ceil(state.produced / CHUNK);
    if (chunks.length < needed) return null;
    const digits = new Uint8Array(state.produced);
    let offset = 0;
    for (let i = 0; i < needed; i++) {
        const take = Math.min(CHUNK, state.produced - offset);
        if (chunks[i].length < take) return null;
        digits.set(chunks[i].subarray(0, take), offset);
        offset += take;
    }
    return { state, digits };
}

export async function saveStream(
    db: IDBDatabase,
    state: SavedState,
    chunks: ChunkWrite[],
): Promise<void> {
    const tx = db.transaction(['state', 'chunks'], 'readwrite');
    const store = tx.objectStore('chunks');
    for (const { index, data } of chunks)
        store.put(data, [state.base, index]);
    tx.objectStore('state').put(state, state.base);
    await done(tx);
}

export async function clearAll(db: IDBDatabase): Promise<void> {
    const tx = db.transaction(['state', 'chunks'], 'readwrite');
    tx.objectStore('state').clear();
    tx.objectStore('chunks').clear();
    await done(tx);
}
