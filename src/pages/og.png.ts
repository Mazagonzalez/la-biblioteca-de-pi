/**
 * Imagen para compartir (1200×630), generada al compilar: Astro
 * prerenderiza este endpoint y deja `dist/og.png`.
 *
 * El fondo es el Mandala del modo Dibujo con los primeros decimales de π,
 * calculados aquí con el mismo spigot de la página. El texto se compone
 * con satori (que convierte las letras en trazos con las fuentes del
 * sitio), resvg pinta el SVG final y sharp lo guarda como PNG de paleta.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { APIRoute } from 'astro';
import satori from 'satori';
import sharp from 'sharp';
import { mandalaSvg } from '@/lib/og-mandala';
import { piDigits } from '@/lib/spigot';

export const prerender = true;

const W = 1200;
const H = 630;
const DIGITS = 12_000;

const C = {
    void: '#09090b',
    fg: '#ede8df',
    dim: '#a29c92',
    mute: '#6f6a63',
    gold: '#d8b06a',
};

const font = (pkg: string, file: string): Promise<Buffer> =>
    readFile(
        join(
            process.cwd(),
            'node_modules/@fontsource',
            pkg,
            'files',
            file,
        ),
    );

type Node = {
    type: string;
    props: { style?: Record<string, unknown>; children?: unknown };
};
const el = (
    style: Record<string, unknown>,
    children?: unknown,
): Node => ({ type: 'div', props: { style, children } });

export const GET: APIRoute = async ({ site }) => {
    const [serif, serifItalic, greekItalic, mono] = await Promise.all(
        [
            font(
                'instrument-serif',
                'instrument-serif-latin-400-normal.woff',
            ),
            font(
                'instrument-serif',
                'instrument-serif-latin-400-italic.woff',
            ),
            // Instrument Serif no trae letras griegas: la π sale de aquí.
            font(
                'noto-serif-display',
                'noto-serif-display-greek-400-italic.woff',
            ),
            font('geist-mono', 'geist-mono-latin-400-normal.woff'),
        ],
    );

    const { integer, digits } = piDigits(10, DIGITS);
    const groups = Array.from({ length: 5 }, (_, g) =>
        Array.from(digits.subarray(g * 5, g * 5 + 5)).join(''),
    );
    const head = `${integer},${groups.join(' ')}…`;
    const host = site?.host ?? 'la-biblioteca-de-pi.vercel.app';

    const serifStack = '"Instrument Serif", "Noto Serif Display"';
    const text = await satori(
        el(
            {
                width: W,
                height: H,
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '64px 72px',
            },
            [
                el(
                    {
                        fontFamily: 'Geist Mono',
                        fontSize: 22,
                        letterSpacing: '0.06em',
                        color: C.mute,
                    },
                    head,
                ),
                el({ display: 'flex', flexDirection: 'column' }, [
                    el(
                        {
                            display: 'flex',
                            flexDirection: 'column',
                            fontFamily: serifStack,
                            fontSize: 118,
                            lineHeight: 0.92,
                            letterSpacing: '-0.01em',
                            color: C.fg,
                        },
                        [
                            el({}, 'La Biblioteca'),
                            el({ display: 'flex' }, [
                                el({}, 'de '),
                                el(
                                    {
                                        fontStyle: 'italic',
                                        color: C.gold,
                                    },
                                    'π',
                                ),
                            ]),
                        ],
                    ),
                    el(
                        {
                            marginTop: 30,
                            fontFamily: serifStack,
                            fontStyle: 'italic',
                            fontSize: 44,
                            color: C.dim,
                        },
                        'Todo está aquí, en algún lugar.',
                    ),
                ]),
                el(
                    {
                        fontFamily: 'Geist Mono',
                        fontSize: 20,
                        letterSpacing: '0.04em',
                        color: C.mute,
                    },
                    host,
                ),
            ],
        ) as never,
        {
            width: W,
            height: H,
            fonts: [
                {
                    name: 'Instrument Serif',
                    data: serif,
                    weight: 400,
                    style: 'normal',
                },
                {
                    name: 'Instrument Serif',
                    data: serifItalic,
                    weight: 400,
                    style: 'italic',
                },
                {
                    name: 'Noto Serif Display',
                    data: greekItalic,
                    weight: 400,
                    style: 'italic',
                },
                {
                    name: 'Geist Mono',
                    data: mono,
                    weight: 400,
                    style: 'normal',
                },
            ],
        },
    );

    const cx = 905;
    const cy = H / 2;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
        `<defs><radialGradient id="og-glow" cx="${cx}" cy="${cy}" r="330" gradientUnits="userSpaceOnUse">` +
        `<stop offset="0" stop-color="${C.gold}" stop-opacity="0.10"/>` +
        `<stop offset="1" stop-color="${C.gold}" stop-opacity="0"/>` +
        `</radialGradient></defs>` +
        `<rect width="${W}" height="${H}" fill="${C.void}"/>` +
        `<circle cx="${cx}" cy="${cy}" r="330" fill="url(#og-glow)"/>` +
        mandalaSvg(digits, { cx, cy, radius: 268, symmetry: 6 }) +
        text +
        `</svg>`;

    const raw = new Resvg(svg, {
        fitTo: { mode: 'width', value: W },
    })
        .render()
        .asPng();

    // resvg no comprime bien los trazos translúcidos (~300 KB+). Con una
    // paleta de 256 colores el PNG baja mucho y a simple vista es igual.
    const png = await sharp(raw)
        .png({ palette: true, quality: 90, effort: 10 })
        .toBuffer();

    return new Response(new Uint8Array(png), {
        headers: { 'Content-Type': 'image/png' },
    });
};
