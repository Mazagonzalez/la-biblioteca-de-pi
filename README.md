# π infinito

Una página que calcula π sin detenerse, en el navegador, y deja ver su
aleatoriedad mientras crece. Astro + TypeScript (strict) + Tailwind, sin
frameworks de UI. Todo corre en el cliente; se despliega como sitio estático.

## Cómo funciona

- **Spigot de Gibbons con BigInt**, genérico en cualquier base
  (`src/lib/spigot.ts`). Para no pagar una división BigInt en cada paso, la
  prueba «¿es seguro el dígito?» se hace con los ~60 bits altos del estado y
  solo se recurre a la división exacta en los casos límite; además, los
  términos de la serie se componen de varios en varios. El resultado es
  idéntico al algoritmo de referencia y unas 20 veces más rápido.
- **Web Worker** (`src/workers/pi.worker.ts`): un flujo por base; solo avanza
  el de la base activa. Envía lotes cada ~40 ms como `Uint8Array`
  transferible.
- **Almacén** en trozos de `Uint8Array` crecientes (`src/lib/store.ts`).
- **Estadísticas incrementales** (`src/lib/stats.ts`): histograma, χ² con
  p-valor (gamma incompleta regularizada) y rachas.
- **Visor virtualizado** (`src/lib/renderers/text-viewer.ts`): solo pinta las
  filas visibles, con «seguir al último».

## Estado

- [x] Núcleo: spigot, worker, modo Dígitos y panel de aleatoriedad
- [ ] Letras (base 26), Color, Caminata (base 4), Sonido
- [ ] Buscador

## Comandos

| Comando       | Acción                                     |
| ------------- | ------------------------------------------ |
| `pnpm dev`    | Servidor de desarrollo en `localhost:4321` |
| `pnpm build`  | Genera el sitio estático en `./dist/`      |
| `pnpm test`   | Tests (Vitest)                             |
| `pnpm lint`   | ESLint                                     |
| `pnpm format` | Prettier                                   |
