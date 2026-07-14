# Stride — AI Sprint Biomechanics Analysis

Stride is a mobile app that gives sprinters and coaches real-time biomechanical feedback from phone video. Record a sprint, get an AI-powered analysis of form, and receive a personalized training plan — no lab, no markers, no setup.

## What It Does

1. **Record or import** a sprint video from your phone
2. **AI pose estimation** tracks 17 body keypoints at up to 240fps
3. **Biomechanical analysis** computes joint angles, stride metrics, and detects form issues
4. **LLM coaching** generates personalized drill recommendations grounded in the athlete's real data
5. **Training plan** schedules corrective drills on a calendar with volume and coaching cues

## Architecture

```
┌─────────────────┐       ┌──────────────┐       ┌──────────────────┐
│  React Native   │──────▶│  Express API │──────▶│  Aurora DSQL     │
│  (Expo / iOS /  │       │  (TypeScript)│       │  (PostgreSQL)    │
│   Android)      │       └──────┬───────┘       └──────────────────┘
└─────────────────┘              │
                                 │ SQS
                                 ▼
                          ┌──────────────┐
                          │  ML Worker   │
                          │  (Python)    │
                          │  TensorFlow  │
                          │  RTMPose     │
                          │  OpenCV      │
                          └──────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native, Expo, TypeScript |
| API | Express 5, TypeScript, Zod, Supabase Auth (JWT) |
| ML/CV | Python, TensorFlow, RTMPose (ONNX), OpenCV, NumPy, SciPy |
| LLM | Groq (Llama 3.3 70B), Gemini 1.5 Pro (fallback) |
| Database | AWS Aurora DSQL (PostgreSQL-compatible, serverless) |
| Storage | AWS S3 (video), SQS (job queue) |
| Infrastructure | AWS ECS Fargate, ALB, Terraform, Docker |
| Auth | Supabase (JWT, JWKS verification) |
| CI/CD | GitHub Actions |

## ML Pipeline

```
Video → RTMPose 2D keypoints → Gravity-anchored canonicalization →
Sagittal biomechanics (angles, phases, gait timing) →
Trust-tiered metric reporting → Flaw detection → LLM coaching report
```

Key features of the CV system:
- **Crop-to-target tracking** — IoU-based person tracking locks onto the selected athlete in multi-person clips
- **Gravity-anchored angles** — uses phone accelerometer to measure joint angles against true vertical, not camera-relative
- **Trust tiers** — metrics are labeled trusted/experimental based on viewing angle, fps, and confidence. Only trusted metrics raise flaws.
- **Phase-aware norms** — different thresholds for acceleration vs max-velocity phase
- **Dual-rate temporal analysis** — 120fps ankle signal for accurate ground contact time, 15fps pose for joint angles

## Project Structure

```
apps/
  api/           — Express API (TypeScript)
  ml-worker/     — Python ML pipeline (pose estimation + biomechanics)
  mobile/        — React Native app (Expo)
packages/
  types/         — Shared TypeScript types
  content/       — Coaching knowledge base
  design-tokens/ — Design system tokens
infra/
  terraform/     — AWS infrastructure as code
  docker-compose.yml — Local development stack
scripts/         — Deploy/undeploy/dev automation
docs/
  research/      — ML architecture + angle-agnostic kinematics research
  benchmarks/    — Pipeline accuracy + app E2E baselines
```

## Key Engineering Decisions

- **2D-first, 3D-optional**: Sagittal 2D analysis is accurate to 3-5° from side-on video (validated against VideoRun2D literature). WHAM 3D lift available as an upgrade path when GPU is added.
- **Honesty over hallucination**: Metrics that can't be reliably measured (bad angle, low fps, low confidence) are reported as "experimental" and never generate false-positive flaws.
- **IAM token auth for database**: No static passwords — ECS tasks authenticate to DSQL using short-lived IAM tokens.
- **Agent-based coaching**: The AI coach uses a multi-step tool-calling agent (not a single LLM prompt) with access to the athlete's metrics history, drill library, and calendar.
- **Local-first development**: Full stack runs locally via docker-compose or native processes — no AWS dependency for development.

## Running Locally

```bash
# Install dependencies
npm install

# Start local stack (Postgres + API + ML worker)
./scripts/dev-local.sh

# Start mobile app
cd apps/mobile && npx expo start
```

## Deployment

```bash
cd infra/terraform
terraform init && terraform apply

# Deploy containers
./scripts/deploy.sh
```

## Status

Working end-to-end: video upload → ML analysis → results → AI coach → calendar planning. Pre-launch (HTTPS + app store submission remaining).
