import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import eslintPluginAstro from 'eslint-plugin-astro';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
    globalIgnores(['dist/', '.astro/', 'node_modules/', '.vercel/']),
    {
        files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
        plugins: { js },
        extends: ['js/recommended'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['src/workers/**/*.ts'],
        languageOptions: { globals: globals.worker },
    },
    tseslint.configs.recommended,
    ...eslintPluginAstro.configs.recommended,
]);
