import type { APIRoute } from 'astro';

/** La URL del sitemap sale de `site` en `astro.config.mjs`. */
export const GET: APIRoute = ({ site }) => {
    const sitemap = new URL('/sitemap.xml', site).href;
    return new Response(
        `User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`,
        {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        },
    );
};
