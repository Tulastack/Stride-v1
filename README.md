# Stride

AI-powered sprint biomechanics from phone video. Record a sprint, get a full breakdown of your form, and a training plan to fix what's off.

![Stride Analysis](docs/assets/demo.gif)

## How It Works

You film a sprint (or import a video). The app runs pose estimation on every frame, computes joint angles and stride metrics, detects form issues, then generates a personalized coaching report with drills and a calendar plan.

The whole pipeline runs in about 15 seconds per clip.

## Architecture

```
React Native App → Express API → Aurora DSQL (Postgres)
                       ↓
                   SQS Queue
                       ↓
                  ML Worker (Python)
                  RTMPose + TensorFlow
                  Biomechanics Engine
                  LLM Coach (Groq/Gemini)
```

## Stack

| Layer | What |
|-------|------|
| Mobile | React Native, Expo, TypeScript |
| API | Express 5, TypeScript, Supabase Auth |
| ML | Python, TensorFlow, RTMPose, OpenCV, SciPy |
| LLM | Groq (Llama 3.3 70B), Gemini 1.5 Pro fallback |
| Database | AWS Aurora DSQL |
| Storage | S3 for video, SQS for job queue |
| Infra | ECS Fargate, ALB, Terraform |

## ML Pipeline

Video frames go through RTMPose (2D keypoints), then gravity-anchored canonicalization (phone accelerometer aligns angles to true vertical), then sagittal biomechanics (joint angles, stride phases, gait timing), then trust-tiered reporting (only confident measurements raise flaws), then the LLM generates coaching advice grounded in the athlete's actual numbers.

Key things worth noting:

The system tracks a specific person using IoU-based bounding box matching, so it works in multi-person clips. Metrics are labeled trusted or experimental depending on camera angle, fps, and keypoint confidence. Only trusted metrics generate flaw alerts. The coach is a multi-step agent with tools (not a single prompt), so it can look up the athlete's history, drill library, and calendar before answering.

## Project Layout

```
apps/api/          Express API (TypeScript)
apps/ml-worker/    ML pipeline (Python)
apps/mobile/       React Native app (Expo)
packages/          Shared types, design tokens
infra/terraform/   AWS infrastructure
scripts/           Deploy and dev automation
docs/              Research and benchmarks
```

## Running Locally

```
npm install
./scripts/dev-local.sh
cd apps/mobile && npx expo start
```

## Deploying

```
cd infra/terraform && terraform apply
./scripts/deploy.sh
```

## Status

Working end-to-end. Pre-launch (HTTPS and app store submission remaining).
