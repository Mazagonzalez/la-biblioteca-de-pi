/**
 * Servidor de La Biblioteca de π: calcula π sin parar y lo sirve a todos los
 * visitantes.
 *
 *   GET /health                    → "ok"
 *   GET /api/info                  → progreso de cada base (JSON)
 *   GET /api/digits/:base          → todos los dígitos calculados (gzip)
 *   GET /api/stream/:base?from=N   → dígitos desde N y luego en vivo (SSE)
 *
 * Variables de entorno:
 *   PORT      puerto HTTP (Railway lo define)              — 8787
 *   DATA_DIR  carpeta del volumen persistente              — ./server/data
 *   CPU_DUTY  fracción de una CPU que se usa para calcular — 0.1
 *   BASES     bases y pesos, p. ej. "10:2,26:1,4:1"         — 10:2,26:1,4:1
 */
import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from 'node:http';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { Calculator, type Stream } from './calculator.ts';

const gzipAsync = promisify(gzip);

const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? './server/data';
const DUTY = Math.min(
    1,
    Math.max(0.01, Number(process.env.CPU_DUTY ?? 0.1)),
);
const BASES = parseBases(process.env.BASES ?? '10:2,26:1,4:1');
/** Trozo máximo por evento SSE al ponerse al día (dígitos). */
const SSE_CHUNK = 1 << 16;
const MAX_CLIENTS = 1000;
/** La copia comprimida se rehace como mucho cada tanto (ms). */
const GZIP_TTL_MS = 30_000;

function parseBases(spec: string): Map<number, number> {
    const bases = new Map<number, number>();
    for (const part of spec.split(',')) {
        const [b, w = '1'] = part.trim().split(':');
        const base = Number(b);
        const weight = Number(w);
        if (
            Number.isInteger(base) &&
            base >= 2 &&
            base <= 36 &&
            weight > 0
        ) {
            bases.set(base, weight);
        }
    }
    if (bases.size === 0) throw new Error(`BASES inválido: ${spec}`);
    return bases;
}

function log(msg: string): void {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

const calc = new Calculator({
    dataDir: DATA_DIR,
    duty: DUTY,
    bases: BASES,
    log,
});
await calc.load();
calc.start();
log(
    `calculando con ${Math.round(DUTY * 100)} % de CPU · bases ${[...BASES.keys()].join(', ')}`,
);

// --- Utilidades HTTP --------------------------------------------------------

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers':
        'X-Digits-Count, X-Elapsed-Ms, X-Integer-Part, X-Started-At',
};

function send(
    res: ServerResponse,
    status: number,
    body: string,
    type = 'text/plain; charset=utf-8',
): void {
    res.writeHead(status, {
        ...CORS,
        'Content-Type': type,
        'Cache-Control': 'no-store',
    });
    res.end(body);
}

function streamFor(raw: string | undefined): Stream | undefined {
    return calc.streams.get(Number(raw));
}

// --- /api/info --------------------------------------------------------------

function info(res: ServerResponse): void {
    const bases = [...calc.streams.values()].map((s) => ({
        base: s.base,
        length: s.length,
        integerPart: s.integerPart,
        elapsedMs: Math.round(s.elapsedMs),
    }));
    send(
        res,
        200,
        JSON.stringify({
            startedAt: calc.startedAt,
            duty: calc.duty,
            bases,
        }),
        'application/json',
    );
}

// --- /api/digits/:base ------------------------------------------------------

const gzCache = new Map<
    number,
    { at: number; count: number; elapsedMs: number; data: Buffer }
>();
const gzPending = new Map<number, Promise<void>>();

async function digits(
    res: ServerResponse,
    stream: Stream,
): Promise<void> {
    let cached = gzCache.get(stream.base);
    if (!cached || Date.now() - cached.at > GZIP_TTL_MS) {
        let pending = gzPending.get(stream.base);
        if (!pending) {
            const count = stream.length;
            const elapsedMs = stream.elapsedMs;
            const raw = stream.view(0, count).slice();
            pending = gzipAsync(raw, { level: 6 })
                .then((data) => {
                    gzCache.set(stream.base, {
                        at: Date.now(),
                        count,
                        elapsedMs,
                        data,
                    });
                })
                .finally(() => gzPending.delete(stream.base));
            gzPending.set(stream.base, pending);
        }
        await pending;
        cached = gzCache.get(stream.base);
    }
    if (!cached) return send(res, 503, 'sin datos');
    res.writeHead(200, {
        ...CORS,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'gzip',
        'Content-Length': cached.data.length,
        'Cache-Control': 'no-store',
        'X-Digits-Count': cached.count,
        'X-Elapsed-Ms': Math.round(cached.elapsedMs),
        'X-Integer-Part': stream.integerPart,
        'X-Started-At': calc.startedAt,
    });
    res.end(cached.data);
}

// --- /api/stream/:base?from=N -----------------------------------------------

let clients = 0;

function event(
    res: ServerResponse,
    start: number,
    digits: Uint8Array,
    elapsedMs: number,
): void {
    const d = Buffer.from(
        digits.buffer,
        digits.byteOffset,
        digits.length,
    ).toString('base64');
    res.write(
        `event: batch\ndata: {"start":${start},"elapsedMs":${Math.round(elapsedMs)},"d":"${d}"}\n\n`,
    );
}

function live(
    req: IncomingMessage,
    res: ServerResponse,
    stream: Stream,
    from: number,
): void {
    if (clients >= MAX_CLIENTS)
        return send(res, 503, 'demasiadas conexiones');
    clients++;
    res.writeHead(200, {
        ...CORS,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    // Ponerse al día desde `from`.
    for (
        let at = Math.max(0, from);
        at < stream.length;
        at += SSE_CHUNK
    ) {
        const end = Math.min(stream.length, at + SSE_CHUNK);
        event(res, at, stream.view(at, end), stream.elapsedMs);
    }

    const listener = (
        start: number,
        digits: Uint8Array,
        elapsedMs: number,
    ) => {
        if (start + digits.length <= from) return;
        event(res, start, digits, elapsedMs);
    };
    stream.listeners.add(listener);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
    req.on('close', () => {
        clients--;
        clearInterval(ping);
        stream.listeners.delete(listener);
    });
}

// --- Router ------------------------------------------------------------------

const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            ...CORS,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
        });
        return res.end();
    }
    if (req.method !== 'GET') return send(res, 405, 'solo GET');

    if (url.pathname === '/health') return send(res, 200, 'ok');
    if (url.pathname === '/api/info') return info(res);
    if (parts[0] === 'api' && parts[1] === 'digits') {
        const stream = streamFor(parts[2]);
        if (!stream) return send(res, 404, 'base desconocida');
        digits(res, stream).catch((error: unknown) => {
            log(`error comprimiendo: ${String(error)}`);
            if (!res.headersSent) send(res, 500, 'error');
        });
        return;
    }
    if (parts[0] === 'api' && parts[1] === 'stream') {
        const stream = streamFor(parts[2]);
        if (!stream) return send(res, 404, 'base desconocida');
        const from = Number(url.searchParams.get('from') ?? 0);
        return live(
            req,
            res,
            stream,
            Number.isFinite(from) ? from : 0,
        );
    }
    if (url.pathname === '/') {
        return send(
            res,
            200,
            'La Biblioteca de π · servidor de cálculo. Ver /api/info',
        );
    }
    send(res, 404, 'no encontrado');
});

server.listen(PORT, () => log(`escuchando en :${PORT}`));

// Railway envía SIGTERM al redesplegar: guardar antes de salir.
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
        if (closing) return;
        closing = true;
        log(`${signal}: guardando y cerrando…`);
        server.close();
        server.closeAllConnections();
        calc.stop()
            .then(() => log('guardado. adiós'))
            .finally(() => process.exit(0));
    });
}
