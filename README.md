# la-biblioteca-de-pi

Proyecto creado con [create-amg-astro](https://www.npmjs.com/package/create-amg-astro): Astro + React + Tailwind + ESLint + Prettier.

## Estructura

```text
/
├── public/             favicon.svg, favicon.ico
├── src/
│   ├── layouts/        Layout.astro
│   ├── pages/          index.astro
│   └── styles/         global.css, components.css, scrollbar.css, animations.css
├── astro.config.mjs
└── package.json
```

## Comandos

| Comando             | Acción                                        |
| ------------------- | --------------------------------------------- |
| `pnpm dev`          | Servidor de desarrollo en `localhost:4321`    |
| `pnpm build`        | Genera el sitio de producción en `./dist/`    |
| `pnpm preview`      | Sirve el build localmente antes de publicarlo |
| `pnpm lint`         | Revisa el código con ESLint                   |
| `pnpm format`       | Formatea el código con Prettier               |
| `pnpm format:check` | Comprueba el formato sin modificar archivos   |
