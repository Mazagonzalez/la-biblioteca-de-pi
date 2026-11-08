# La Biblioteca de π

_Todo está aquí, en algún lugar._ Un homenaje a «La biblioteca de Babel» de
Borges: si π es un número normal (algo que nadie ha demostrado), sus
decimales contienen todas las secuencias posibles.

Una página que calcula π sin detenerse, en el navegador, y deja ver su
aleatoriedad mientras crece. Astro + TypeScript (strict) + Tailwind, sin
frameworks de UI. La web es un sitio estático; opcionalmente se conecta a un
servidor que calcula π sin parar para todos (ver «π global»).

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
- **Renderers** en `src/lib/renderers/` (texto, píxeles, caminata) y audio en
  `src/lib/audio.ts`.
- **Visor virtualizado** (`src/lib/renderers/text-viewer.ts`): solo pinta las
  filas visibles, con «seguir al último».

## Imagen para compartir

`og.png` (1200×630) se genera al compilar en `src/pages/og.png.ts`: calcula
los primeros decimales con el mismo spigot, dibuja el Mandala del modo Dibujo
(`src/lib/og-mandala.ts`), compone el texto con `satori` y lo pasa a PNG con
`@resvg/resvg-js`. Las URL absolutas (canonical, `og:url`, `og:image`) salen
de `site` en `astro.config.mjs`.

## Progreso guardado

Cada navegador guarda su progreso en IndexedDB (`src/lib/persist.ts`): los
dígitos en trozos de 64 KiB y el estado del spigot (`q`, `r`, `t` en
hexadecimal) en la misma transacción. Se guarda cada ~5 s de cálculo y al
pausar, cambiar de modo u ocultar la página; al volver, el cálculo sigue
donde quedó. «Empezar de cero», en el panel, lo borra.

## π global (servidor)

Si la web tiene definida `PUBLIC_PI_SERVER`, no calcula por su cuenta: se
conecta a un servidor que calcula π sin parar, y todos los visitantes ven el
mismo número creciendo en vivo. Si el servidor no responde, la web vuelve a
calcular en el navegador.

El servidor (`server/`) es Node 24 + TypeScript sin dependencias y reutiliza
`src/lib/spigot.ts`:

- Calcula las bases 10, 26 y 4 por turnos, usando solo `CPU_DUTY` de una CPU
  (por defecto 10 %, para caber en el plan Hobby de Railway).
- Guarda en disco (`DATA_DIR`) los dígitos y el estado del spigot cada ≥15 s,
  y también al recibir SIGTERM; al reiniciar sigue desde ahí.
- `GET /api/info`, `GET /api/digits/:base` (gzip) y
  `GET /api/stream/:base?from=N` (SSE con los lotes nuevos).

### Desplegar en Railway

1. **New Project → Deploy from GitHub repo** y elige este repositorio.
   Railway lee `railway.json` y construye `server/Dockerfile`.
2. En el servicio: **Volumes → New Volume**, montado en `/data`. Sin volumen
   el progreso se pierde en cada despliegue.
3. **Variables** (opcionales): `CPU_DUTY=0.1`, `BASES=10:2,26:1,4:1`.
4. **Settings → Networking → Generate Domain** y copia la URL.
5. **Usage → Usage limits**: pon un límite duro de 5 USD para que nunca se
   pase del plan.
6. En **Vercel**, añade la variable `PUBLIC_PI_SERVER` con esa URL (sin `/`
   final) y vuelve a desplegar la web.

En local: `pnpm server` (usa `server/data/`) y
`PUBLIC_PI_SERVER=http://localhost:8787 pnpm dev`.

## Modos

| Modo     | Base | Qué muestra                                                                                                                                                   |
| -------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dígitos  | 10   | Texto en bloques de 10, virtualizado, con «seguir al último»                                                                                                  |
| Letras   | 26   | Lo mismo con A = 0 … Z = 25                                                                                                                                   |
| Color    | 10   | Un píxel por dígito (ImageData), paleta apta para daltonismo, zoom 1–16 px                                                                                    |
| Caminata | 4    | 0↑ 1→ 2↓ 3←, degradado por posición, encuadre automático, zoom y paneo                                                                                        |
| Sonido   | 10   | Escala pentatónica con Web Audio, volumen y tempo independientes del cálculo                                                                                  |
| Dibujo   | 10   | Hilos (cada decimal unido al siguiente), Mandala (caminata de 10 direcciones en caleidoscopio) o Constelaciones (cada grupo de decimales es una constelación) |

## Tu recuerdo

La primera vez que un navegador abre la página se guarda en `localStorage`
el decimal por el que iba π en ese momento (`src/lib/memento.ts`). El panel
lo muestra con la fecha y cuánto ha crecido π desde entonces, y «Ver dónde»
salta a ese decimal y lo resalta.

## Analíticas

Vercel Web Analytics (visitas, sin cookies) y Speed Insights (rendimiento
real) se cargan desde `src/layouts/Layout.astro`, **solo en producción**:
cuando Vercel construye con `VERCEL_ENV=production`. En local y en las
vistas previas de los PR no se incluyen. Hay que activarlos en el proyecto
de Vercel (pestañas **Analytics** y **Speed Insights**).

## Buscador

Cifras → base 10 (p. ej. una fecha); letras → base 26 (p. ej. un nombre).
Usa Knuth–Morris–Pratt con estado entre lotes (`src/lib/search.ts`), así que
no pierde coincidencias que cruzan el borde entre dos lotes, y revisa lo ya
calculado en porciones de ~6 ms para no bloquear el hilo principal. Atajo: `/`.

## Comandos

| Comando          | Acción                                     |
| ---------------- | ------------------------------------------ |
| `pnpm dev`       | Servidor de desarrollo en `localhost:4321` |
| `pnpm build`     | Genera el sitio estático en `./dist/`      |
| `pnpm test`      | Tests (Vitest)                             |
| `pnpm lint`      | ESLint                                     |
| `pnpm format`    | Prettier                                   |
| `pnpm server`    | Servidor de cálculo global en `:8787`      |
| `pnpm typecheck` | Tipos de la web y del servidor             |

## Licencia

[MIT](LICENSE) © 2026 Carlos Maza. Puedes usar, copiar y modificar el código
libremente, siempre que conserves el aviso de autoría.
