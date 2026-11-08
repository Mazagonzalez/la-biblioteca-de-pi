// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
    // URL de producción: de aquí salen el canonical y las URL absolutas
    // de og:url y og:image.
    site: 'https://la-biblioteca-de-pi.vercel.app',
    vite: {
        plugins: [tailwindcss()],
        worker: { format: 'es' },
    },
});
