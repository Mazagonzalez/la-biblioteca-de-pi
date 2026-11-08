/// <reference types="astro/client" />

interface ImportMetaEnv {
    /** URL del servidor de cálculo global (p. ej. https://pi.up.railway.app). */
    readonly PUBLIC_PI_SERVER?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
