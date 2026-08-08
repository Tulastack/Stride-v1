# Stride — Landing Page

One-page marketing site for Stride. Dark "stadium at night" aesthetic matching
the pitch-deck palette: champagne gold `#E8C87D`, beige `#F2F2EF`, warm dark
greys (`#100F0D`–`#3E3931`). Type: Space Grotesk (display), Instrument Sans
(body), IBM Plex Mono (numerals).

## Stack

- **Vite + React 19 + TypeScript**
- **Tailwind CSS v4** — brand tokens defined in `src/index.css` `@theme`
- **Motion (Framer Motion)** — scroll reveals, sticky pipeline, hero choreography
- **Lenis** — smooth scrolling
- **React Three Fiber + drei + postprocessing** — three scenes driven by the
  parametric sprint-kinematics engine in `src/lib/gait.ts`:
  - `RunnerScene` (hero): dot-matrix sprinter on a scrolling track with live
    joint-angle readouts, motion trail and bloom
  - `PipelineScene` (engine section): per-step live 3D — orbiting camera,
    keypoint extraction, gravity tilt-correction, measurement, slow-mo review
  - `BlocksScene` (waitlist): a block start in slow motion with a heat-haze
    warp effect, accelerating away across the bottom of the section

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
node scripts/shoot-blocks.mjs <outDir>        # frames of the waitlist block-start loop
node scripts/test-form.mjs <outDir>           # waitlist form + nav CTA smoke test
```

All three drive the locally installed Chrome via puppeteer-core against
`http://localhost:5199` (start the dev server with
`npm run dev -- --port 5199` first).
