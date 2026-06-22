# Stride — Local Setup & Startup Guide

This monorepo contains the **mobile app** (Expo), **API** (Express + Postgres), **ML worker** (MoveNet → WHAM/OpenCap → biomechanics), and shared packages (`@stride/types`, `@stride/design-tokens`, `@stride/content`).

Use this guide to run everything from **UI-only exploration** up to the **full capture → upload → 3D analysis → coach/progress** loop.

---

## Quick reference — startup methods

| Method | What runs | Best for |
|--------|-----------|----------|
| **[A] Full Docker stack** | Postgres + LocalStack + API + ML worker | End-to-end pipeline (recommended) |
| **[B] Hybrid** | Docker (Postgres + LocalStack) + native API + native worker | Faster API/worker iteration |
| **[C] Native API only** | `npm run dev:api` + Docker infra | Backend route development |
| **[D] Mobile UI only** | `npm run dev:mobile` | Screens, design system, no upload |
| **[E] Turbo dev (all apps)** | `npm run dev` from root | Running API + mobile watchers together |
| **[F] Test stack** | `npm run test:env:up` | CI-style integration tests |
| **[G] Unit tests** | `npm test` in `apps/api` / `apps/mobile` | Regression checks |
| **[H] Biomech validation** | `npm run validate:biomech` | Metric trust / experimental gate |

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | ≥ 22 (root `package.json`) | API Docker image uses Node 20 — both work locally |
| **npm** | 10+ | Monorepo workspaces |
| **Docker + Docker Compose** | Recent | Postgres, LocalStack, optional full stack |
| **Expo Go** or **Xcode Simulator** | — | Mobile |
| **Python** | 3.11–3.12 (optional) | Only if running ML worker **outside** Docker |
| **Supabase project** | — | **Required for real uploads** (see Auth below) |

---

## 0. First-time install (every method)

From the repo root:

```bash
npm ci
```

Build shared packages (required before mobile tests, mobile dev, and native API dev):

```bash
npm run build --workspace=@stride/types \
              --workspace=@stride/design-tokens \
              --workspace=@stride/content
```

> Workspace packages export from `dist/`. Skip this step and mobile/API will fail with `Cannot find module '@stride/…'`.

---

## 1. Environment configuration

### API — `apps/api/.env`

Copy the example and edit:

```bash
cp apps/api/.env.example apps/api/.env
```

**Local Docker stack values** (match `infra/docker-compose.yml`):

```env
PORT=3000
NODE_ENV=development

DATABASE_URL=postgres://stride:stride_dev@localhost:5432/stride

# Real Supabase project (required for authenticated API calls)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_JWT_SECRET=your-supabase-jwt-secret

# LocalStack (local AWS emulation)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT=http://localhost:4566
S3_BUCKET=stride-videos
SQS_QUEUE_URL=http://localhost:4566/000000000000/stride-analysis

# Must match ml-worker INTERNAL_API_SECRET
INTERNAL_API_SECRET=dev-internal-secret-change-in-prod
```

### ML worker — environment

When running via Docker Compose, env is set in `infra/docker-compose.yml`. For **native** worker runs, export the same values:

```bash
export DATABASE_URL=postgres://stride:stride_dev@localhost:5432/stride
export AWS_ENDPOINT=http://localhost:4566
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
export S3_BUCKET=stride-videos
export SQS_QUEUE_URL=http://localhost:4566/000000000000/stride-analysis
export API_SERVER_URL=http://localhost:3000
export INTERNAL_API_SECRET=dev-internal-secret-change-in-prod
export PYTHONPATH=apps/ml-worker
```

Optional worker flags (see §5):

```bash
export STRIDE_WHAM_REPO=/path/to/wham/checkout   # learned WHAM Stage 2
export STRIDE_LEGACY_PIPELINE=1                  # old 2D + LLM path (not PRD v2.2)
```

### Mobile — API URL

Default in `apps/mobile/src/store/useStrideStore.ts`:

```ts
apiBaseUrl: 'http://localhost:3000'
```

| Target | `apiBaseUrl` |
|--------|----------------|
| iOS Simulator | `http://localhost:3000` |
| Android Emulator | `http://10.0.2.2:3000` |
| Physical device | `http://YOUR_LAN_IP:3000` (same Wi‑Fi as your Mac) |

Change at runtime by patching the store or adding a dev settings screen.

---

## 2. Auth — read this before testing uploads

The API verifies **real Supabase JWTs** via JWKS (`apps/api/src/middleware/auth.ts`).

The mobile login screen currently sets a **mock token** for Quick Demo. That lets you browse UI, but **upload, consent API, and history will return 401** until you use real Supabase auth.

**To test the full pipeline:**

1. Create a [Supabase](https://supabase.com) project.
2. Set `SUPABASE_URL` (and optionally `SUPABASE_JWT_SECRET`) in `apps/api/.env`.
3. Wire the mobile app to `supabase.auth.signInWithPassword()` (or OAuth) and store the returned access token in `useStrideStore.setToken()`.

**Offline fallbacks today:**

- Consent screen proceeds even if the API call fails.
- Quick Demo skips auth for UI-only testing.

---

## 3. Method A — Full Docker stack (recommended for E2E)

Runs Postgres (with schema auto-init), LocalStack (S3 + SQS), API, and ML worker.

```bash
# From repo root
docker compose -f infra/docker-compose.yml up -d --build
```

Verify services:

```bash
# API health
curl http://localhost:3000/health

# ML worker polling SQS
docker compose -f infra/docker-compose.yml logs -f ml-worker
# Expect: "Starting Stride ML Worker (WHAM+OpenCap=True) … Polling SQS"
```

Stop:

```bash
docker compose -f infra/docker-compose.yml down
```

**Ports:**

| Service | Port |
|---------|------|
| API | 3000 |
| Postgres | 5432 |
| LocalStack | 4566 |

**Note:** The ML worker Docker image uses TensorFlow + MoveNet. You do **not** need TensorFlow installed on your host.

---

## 4. Method B — Hybrid (Docker infra + native API/worker)

Useful when iterating on API or worker code with hot reload.

### Step 1 — Infrastructure only

```bash
docker compose -f infra/docker-compose.yml up -d postgres localstack localstack-init
```

Wait until Postgres is healthy and LocalStack init completes (S3 bucket + SQS queue created).

### Step 2 — API (native, hot reload)

```bash
# Ensure apps/api/.env is configured (§1)
npm run dev:api
# or: cd apps/api && npm run dev
```

API listens on **http://localhost:3000**.

### Step 3 — ML worker (native Python)

```bash
cd apps/ml-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Pre-download MoveNet (first run only)
python -c "import tensorflow_hub as hub; hub.load('https://tfhub.dev/google/movenet/singlepose/thunder/4')"

# Export env from §1, then:
python -u src/worker.py
```

> **Python version:** Use 3.11 or 3.12 locally. Very new Python versions may lack TensorFlow wheels — use Docker for the worker if `pip install tensorflow` fails.

---

## 5. Method C — Native API only

For route/handler work without processing videos:

```bash
docker compose -f infra/docker-compose.yml up -d postgres localstack localstack-init
npm run build --workspace=@stride/types
npm run dev:api
```

Hit `http://localhost:3000/health`. Upload/analysis endpoints need the ML worker running for jobs to complete.

---

## 6. Method D — Mobile app only (UI)

No backend required for browsing screens with Quick Demo.

```bash
npm run build --workspace=@stride/design-tokens --workspace=@stride/content
npm run dev:mobile
# or: cd apps/mobile && npm start
```

Then:

| Key / action | Result |
|--------------|--------|
| **i** | iOS Simulator |
| **a** | Android Emulator |
| **w** | Web browser |
| QR code | Expo Go on physical device |

Login → **Quick Demo (Skip Auth)** → explore tabs. Analysis/coach/progress will be empty without completed uploads.

---

## 7. Method E — Turbo dev (API + mobile)

```bash
npm run build --workspace=@stride/types \
              --workspace=@stride/design-tokens \
              --workspace=@stride/content
npm run dev
```

Starts persistent dev tasks defined in `turbo.json` across workspaces. Still need Docker infra (Method A or B) for uploads.

---

## 8. End-to-end test flow (full features)

Once **Method A or B** is running **and auth is wired**:

```
1. Open mobile → log in (real Supabase token)
2. Complete consent (Safety & Consent screen)
3. Upload tab → record side-on sprint video OR import from library
   - Toggle slo-mo preference as desired
   - Gyro + intrinsics are attached to the capture manifest automatically
4. App uploads to S3 via presigned URLs → API enqueues SQS
5. ML worker pipeline:
      MoveNet (Stage 1)
   → WHAM or SMPL-gravity lift (Stage 2)
   → OpenCap-style fit (Stage 3)
   → API Stages 4–7 via POST /internal/analysis-biomech
6. Analysis tab polls GET /videos/:id → renders result_json
7. Coach tab → briefing from analysis history
8. Progress tab → trends + re-test CTA
```

### What “different types of biomechanical analysis” means

There is **one production pipeline** on upload. What varies is **capture quality and viewpoint**, not separate engines:

| You do | What changes in results |
|--------|-------------------------|
| Side-on camera (~15–30° azimuth) | Higher confidence; hip/trunk metrics trusted |
| Head-on or oblique angle | Viewpoint penalty; hip may be `experimental` / low confidence |
| Poor framing / motion blur | Capture nudge; `perMetricUsable` flags |
| Slo-mo vs normal fps | Temporal resolution in Stage 1 |
| Repeat uploads over time | Coach deltas + Progress trends |

Optional pipeline modes (worker env, **not** toggled in the mobile UI):

| Env var | Effect |
|---------|--------|
| `STRIDE_WHAM_REPO=/path/to/wham` | Stage 2 uses learned WHAM (GPU) instead of SMPL-gravity fallback |
| `STRIDE_LEGACY_PIPELINE=1` | Old 2D + LLM report path — **not** the PRD v2.2 contract |
| `ANALYSIS_PROVIDER_MODE=fixture` | API dev provider only — **does not** affect SQS upload path |
| `ANALYSIS_PROVIDER_MODE=local` | API runs engine against on-disk sidecars (dev/scripts) |

---

## 9. Method F — Test infrastructure

CI-style Postgres + LocalStack on different ports:

```bash
npm run test:env:up    # infra/docker-compose.test.yml — Postgres :5433, LocalStack :4567
npm run test:env:down
```

Apply schema manually if needed:

```bash
PGPASSWORD=stride_dev psql -h localhost -p 5433 -U stride -d stride_test \
  -f apps/api/src/db/schema.sql
```

---

## 10. Method G — Running tests

Build packages first (same as §0):

```bash
npm run build --workspace=@stride/types \
              --workspace=@stride/design-tokens \
              --workspace=@stride/content
```

**API unit tests** (no Postgres required):

```bash
cd apps/api
npm test -- --testPathIgnorePatterns=integration
```

**API integration tests** (Postgres on `:5433` + schema):

```bash
npm run test:env:up
PGPASSWORD=stride_dev psql -h localhost -p 5433 -U stride -d stride_test \
  -f apps/api/src/db/schema.sql
cd apps/api && npm test -- --testPathPattern=integration
```

**Mobile tests:**

```bash
cd apps/mobile && npm test
```

**ML worker tests:**

```bash
cd apps/ml-worker && python3 -m pytest tests/ -q
```

**Biomechanics validation report:**

```bash
cd apps/api && npm run validate:biomech
# Writes docs/validation/REPORT.md
```

---

## 11. Method H — Biomech validation gate

Regenerates the per-metric trust report used for in-app `experimental` tags:

```bash
npm run build --workspace=@stride/types
cd apps/api && npm run validate:biomech
```

CI fails if `docs/validation/REPORT.md` is stale relative to the harness output.

---

## 12. Architecture (local)

```
┌─────────────┐     presigned S3      ┌──────────┐
│ Mobile app  │ ────────────────────► │ LocalStack│
│  (Expo)     │     POST /videos/*    │  S3+SQS  │
└──────┬──────┘                       └────┬─────┘
       │                                   │
       │ REST :3000                        │ poll
       ▼                                   ▼
┌─────────────┐   /internal/analysis-*   ┌───────────┐
│  API        │ ◄─────────────────────── │ ML worker │
│  Express    │                          │ MoveNet→  │
└──────┬──────┘                          │ WHAM→OC   │
       │                                 └───────────┘
       ▼
┌─────────────┐
│  Postgres   │
└─────────────┘
```

**Key routes:**

| Route | Purpose |
|-------|---------|
| `POST /videos/upload-url` | Start multipart upload |
| `POST /videos/finalize` | Complete upload + enqueue analysis + `.capture.json` sidecar |
| `GET /videos/:id` | Poll analysis status + `result_json` |
| `GET /analyses/:id/progress` | SSE progress stream |
| `POST /internal/analysis-biomech` | Worker → API biomechanics callback |
| `GET /coach-sessions`, `/suggestions`, `/calendar/*` | Coach + scheduling |

---

## 13. Troubleshooting

### `Cannot find module '@stride/types'` (or design-tokens / content)

```bash
npm run build --workspace=@stride/types \
              --workspace=@stride/design-tokens \
              --workspace=@stride/content
```

### Upload returns 401 Unauthorized

Mock Quick Demo token is not valid. Use real Supabase auth (§2).

### Upload succeeds but analysis stays `pending`

- Check ML worker logs: `docker compose -f infra/docker-compose.yml logs ml-worker`
- Confirm SQS queue URL matches LocalStack: `http://localhost:4566/000000000000/stride-analysis`
- Confirm `INTERNAL_API_SECRET` matches between API and worker

### `localstack-init` hangs on first run

It may be pulling the `amazon/aws-cli` image. Wait 1–2 minutes, then check `docker compose -f infra/docker-compose.yml ps`.

### Mobile cannot reach API on physical device

Use your machine's LAN IP, not `localhost`. Ensure port 3000 is reachable on your network/firewall.

### TensorFlow / MoveNet fails locally

Run the worker in Docker (Method A) instead of native Python.

### Analysis failed / low confidence

Real pipeline — poor video quality, head-on angle, or >40% excluded MoveNet frames triggers failure or low-confidence bands. Re-record side-on with full body in frame.

---

## 14. Production / staging notes

| Flag | When |
|------|------|
| `ANALYSIS_PROVIDER=production-aws` | Swap to `AwsAnalysisProvider` (deferred stub today) |
| Remove `AWS_ENDPOINT` | Real AWS S3 + SQS |
| Restrict CORS in `apps/api/src/index.ts` | Production mobile origins |
| `STRIDE_WHAM_REPO` on GPU worker | Production 3D fidelity |

---

## 15. Related docs

| File | Contents |
|------|----------|
| `docs/validation/REPORT.md` | Per-metric error tables + experimental gate |
| `infra/docker-compose.yml` | Full local stack |
| `infra/docker-compose.test.yml` | Test Postgres + LocalStack |
| `apps/api/.env.example` | API env template |
| `.github/workflows/ci.yml` | CI job definitions |
