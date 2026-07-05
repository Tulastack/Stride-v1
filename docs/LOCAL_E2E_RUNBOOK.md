# Stride — Local End-to-End Runbook

How to bring up the **full working pipeline** locally and run a real
upload → analysis → result cycle, plus the on-phone test.

This is the exact setup that was validated end-to-end:
`Supabase login → S3 upload → SQS → ML worker (RTMPose + 2D sagittal biomechanics)
→ API → Postgres → result`, completing in ~30s.

> **Secrets never live in this file or any committed file.** The Supabase URL,
> anon key, and test-user password go only in the **gitignored** `.env` files
> described below.

---

## 0. What runs where

| Service | How we run it locally | Port |
|---|---|---|
| Postgres | host instance (db `stride_test`) | 5432 |
| LocalStack (S3 + SQS) | Docker | 4566 |
| API (Express) | native `tsx` | 3000 |
| ML worker | native Python venv (`.venv312`) | — (polls SQS) |
| Mobile (Expo) | `expo start` → Expo Go on phone | 8081 |

> The production ML Docker image is `tensorflow:2.19.0-gpu` (amd64/CUDA). On
> Apple Silicon that runs under slow emulation, so **locally we run the worker
> natively** in a Python venv. The 2D pipeline uses RTMPose via `onnxruntime`
> (CPU) and does not need a GPU.

---

## 1. Prerequisites

- Docker Desktop (running)
- Node 22, npm 10
- Python 3.12 (`python3.12`) — TensorFlow has no 3.13/3.14 wheels
- A Supabase project with **email auth** and **one confirmed test user**
  (create via Dashboard → Authentication → Users → *Add user* → check
  **Auto Confirm User**, so no inbox link is needed).

---

## 2. One-time setup

### 2a. Node deps + shared packages
```bash
npm ci
npm run build --workspace=@stride/types --workspace=@stride/design-tokens --workspace=@stride/content
```

### 2b. Native Python worker venv (Apple Silicon friendly)
```bash
cd apps/ml-worker
python3.12 -m venv .venv312 && source .venv312/bin/activate
pip install --upgrade pip "setuptools<81"          # <81: tensorflow_hub still imports pkg_resources
pip install tensorflow tensorflow_hub rtmlib onnxruntime opencv-python-headless \
            numpy scipy pydantic boto3 psycopg2-binary requests sentry-sdk python-dotenv \
            google-genai groq
```

### 2c. Environment files (gitignored — fill in your own values)

`apps/api/.env`
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgres://stride:stride_dev@localhost:5432/stride_test
SUPABASE_URL=https://<your-project>.supabase.co
S3_BUCKET=stride-videos
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_ENDPOINT=http://localhost:4566
SQS_QUEUE_URL=http://localhost:4566/000000000000/stride-analysis
INTERNAL_API_SECRET=dev-internal-secret-change-in-prod
```

`apps/mobile/.env`  (the anon key is a *public* client key by design)
```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public anon/publishable key — NOT the JWT secret>
EXPO_PUBLIC_API_BASE_URL=http://<YOUR_MAC_LAN_IP>:3000   # e.g. http://192.168.1.150:3000
```
Find your LAN IP: `ipconfig getifaddr en0`.

---

## 2d. Docker-free mode (recommended — no LocalStack)

Set `STORAGE_DRIVER=local` and uploads bypass S3/SQS entirely: the phone PUTs
video bytes straight to the API (LAN-reachable), which writes them to a shared
dir; the worker **polls the DB** for pending jobs. No Docker, no LocalStack —
so uploads can't fail on a flaky container.

`apps/api/.env` additions:
```env
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=/tmp/stride-local-storage
PUBLIC_API_URL=http://<YOUR_MAC_LAN_IP>:3000   # so the phone can reach the upload endpoint
```
Worker env additions: `STORAGE_DRIVER=local LOCAL_STORAGE_DIR=/tmp/stride-local-storage`
(and you can drop the `AWS_*` / `SQS_QUEUE_URL` vars). The worker logs
`Starting Stride ML Worker (LOCAL DB-poll ...)`.

In this mode skip the LocalStack step below; only Postgres + API + worker are needed.

## 3. Start the stack (every run)

```bash
# 1) Infra: LocalStack S3 + SQS (creates bucket `stride-videos` + queue `stride-analysis`)
docker compose -f infra/docker-compose.yml up -d localstack localstack-init

# 2) API (native)
cd apps/api && npx tsx src/index.ts      # http://localhost:3000/health -> status: ok

# 3) ML worker (native, new terminal)
cd apps/ml-worker && source .venv312/bin/activate
PYTHONPATH=. \
DATABASE_URL=postgres://stride:stride_dev@localhost:5432/stride_test \
AWS_ENDPOINT=http://localhost:4566 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
S3_BUCKET=stride-videos SQS_QUEUE_URL=http://localhost:4566/000000000000/stride-analysis \
API_SERVER_URL=http://localhost:3000 INTERNAL_API_SECRET=dev-internal-secret-change-in-prod \
STRIDE_PIPELINE=2d POSE2D_BACKEND=rtmpose \
python -u src/worker.py
# expect: "Starting Stride ML Worker (WHAM+OpenCap=False) ..."
```

`STRIDE_PIPELINE` selects the pipeline: `2d` (default, RTMPose + 2D sagittal —
the working path), `wham` (needs GPU + `STRIDE_WHAM_REPO`), `legacy` (2D + LLM).

---

## 4. Run it on your phone (Expo Go)

```bash
cd apps/mobile && npx expo start
```
1. Phone + Mac on the **same Wi-Fi**.
2. Open **Expo Go**, scan the QR.
3. Sign in with your Supabase test user (email + password).
4. Complete the consent screen.
5. Upload tab → record/import a **side-on, full-body** sprint clip.
6. Watch progress → analysis result renders.

---

## 5. Headless E2E check (no phone)

`/tmp/e2e_driver.py` (see history) exercises the whole cycle with a real token:
`password grant → /videos/upload-url → PUT to S3 → /videos/finalize → poll
/videos/:id`. Use it to confirm the backend before touching the phone.

---

## 6. Troubleshooting (issues hit + fixed)

| Symptom | Cause | Fix |
|---|---|---|
| S3 PUT → `Checksum Type mismatch ... crc32` | AWS SDK v3 adds a mandatory CRC32 to presigned uploads | Fixed in `apps/api/src/lib/s3.ts` (`requestChecksumCalculation: 'WHEN_REQUIRED'`) |
| `permission denied for table users` | API pointed at a db the `stride` role can't read | Use `stride_test` (has grants) in `DATABASE_URL` |
| `email_address_invalid` on signup | Supabase rejects fake domains (`test.com`) | Use a real email; create the user Auto-Confirmed in the dashboard |
| Login 401 in prod build | Mobile auth not configured | Set `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| `No module named tensorflow` | Python 3.13/3.14 has no TF wheels | Use Python 3.12 venv |
| `pkg_resources` ImportError | setuptools ≥81 dropped it | `pip install "setuptools<81"` |
| Analysis stuck `pending` | worker not running / wrong `SQS_QUEUE_URL` | check worker log; confirm queue URL |

---

## 7. Known limitations before public production

- **Temporal metrics (contact time, cadence) need ≥120fps capture.** At 25–30fps
  they are unreliable (physics, not a bug). Enforce an fps capture gate.
- **TLS**: the ALB is HTTP-only. App Store rejects this and it leaks biometric
  PII. Needs a domain + ACM cert before public launch.
- **3D/WHAM path** (`STRIDE_PIPELINE=wham`) needs a GPU worker + `STRIDE_WHAM_REPO`.
- Rotate any secret that has ever been shared in plaintext.
