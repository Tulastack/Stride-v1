# Stride — Landing Page

One-page marketing site for Stride. Dark "stadium timing board" aesthetic driven
by the design tokens in `packages/design-tokens` (graphite surfaces, bone text,
volt `#CDFF4F` signal, Archivo / Hanken Grotesk / Space Mono).

## Stack

- **Vite + React 19 + TypeScript**
- **Tailwind CSS v4** — brand tokens defined in `src/index.css` `@theme`
- **Motion (Framer Motion)** — scroll reveals, sticky pipeline, hero choreography
- **Lenis** — smooth scrolling
- **React Three Fiber + drei + postprocessing** — the hero: a procedural
  dot-matrix sprinter driven by a keyframed sprint-gait engine
  (`src/lib/gait.ts`) with live joint-angle readouts, motion trails and bloom

## Develop

```
npm install
npm run dev
```

## Build

```
npm run build   # outputs dist/
```

Deploy `dist/` anywhere static (Vercel, Netlify, S3). The 3D scene is
code-split and streams in after first paint.

## Waitlist

The form posts `{ email, source }` as JSON to `VITE_WAITLIST_ENDPOINT` if set
(e.g. a Formspree URL, Supabase edge function, or your API). Without it the
form still shows the success state but records nothing — set the endpoint
before launch:

```
VITE_WAITLIST_ENDPOINT=https://... npm run build
```

## Visual regression helpers

```
node scripts/screenshot.mjs <outDir>          # desktop sweep of every section
node scripts/screenshot-mobile.mjs <outDir>   # mobile sweep
node scripts/test-form.mjs <outDir>           # waitlist form + nav CTA smoke test
```

All three drive the locally installed Chrome via puppeteer-core against
`http://localhost:5199` (start the dev server with
`npm run dev -- --port 5199` first).
