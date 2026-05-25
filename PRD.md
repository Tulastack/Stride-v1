# Stride Platform Product Requirement Document (PRD) v2.1

Stride is a high-performance, AI-driven athletic coaching platform designed specifically for runners and sprinters. The application replaces open-ended AI chatbots with hyper-focused, low-latency, structured workflows: analyzing biomechanical video uploads, providing immediate numeric joint metrics with actionable feedback, and seamlessly scheduling prescribed corrective drills and recovery days on a PostgreSQL-synchronized calendar.

---

## 1. Monorepo Architecture Overview

Stride is built inside a Turborepo monorepo structure, ensuring strict separation of concerns, modular packaging, and single-source-of-truth types.

```mermaid
graph TD
    subgraph Mobile Client [apps/mobile (Expo SDK 54)]
        UI[React Native View Layer]
        Store[Zustand Local Store]
        Client[Unified API client]
    end

    subgraph Backend Services [apps/api (Express 5)]
        API[Express Router]
        JWT[jose JWT Auth Middleware]
        S3Client[AWS S3 Multipart Client]
        SQSClient[AWS SQS Task Publisher]
    end

    subgraph ML Pipeline [apps/ml-worker (Python)]
        SQS[SQS Task Consumer]
        Pose[MoveNet Thunder v4 Engine]
        Bio[Biomechanics Math Parser]
        GenAI[Gemini 1.5 Flash client]
    end

    subgraph Data Layer
        DB[(PostgreSQL Database)]
        S3[(AWS S3 Video Store)]
    end

    UI --> Store
    Store --> Client
    Client -->|HTTPS / JWT| API
    API -->|Raw SQL| DB
    API -->|S3 Upload Presign| S3
    API -->|Enqueue Video ID| SQSClient
    SQSClient -->|Task Enqueue| SQS
    SQS -->|Fetch Video| S3
    SQS -->|Extract Coordinates| Pose
    Pose -->|Calculate Angles| Bio
    Bio -->|Structured JSON Cues| GenAI
    GenAI -->|Drills & Recommendations| DB
    GenAI -->|Realtime Update SSE| API
```

### Stack Components:
*   **Frontend (`apps/mobile`)**: React Native built on **Expo SDK 54.0.34**, utilizing **Expo Router v6** for file-based routing, **Zustand** for lightweight state management, **Lucide Icons** for interface symbols, and **expo-blur** / **expo-linear-gradient** for premium glassmorphism.
*   **Backend (`apps/api`)**: Node.js **Express 5** server with ESM imports. Connects directly to PostgreSQL using custom connection pooling (no heavy ORM). Authenticates client requests using **jose** for lightweight JWT verification from Supabase.
*   **ML Engine (`apps/ml-worker`)**: A standalone Python service that polls AWS SQS for pending video tasks, runs TensorFlow **MoveNet SinglePose Thunder v4** for pose extraction, performs dynamic angle calculations, and structures specialized sprint feedback through **Gemini 1.5 Flash** using the `google-genai` client.
*   **Shared Types (`packages/types`)**: Centralized TypeScript definition layer mapping schemas, API payload structures, and message protocols.

---

## 2. Core PostgreSQL Database Schema

The database relies on a highly performant, raw SQL relational schema designed to avoid complex JOIN queries on common workflows. It features custom database constraints, UUID primary keys, and specialized indices on user querying patterns.

```sql
-- Stride API Database Schema (schema.sql)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_uid VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    event_specialty VARCHAR(10) CHECK (event_specialty IN ('100m','200m','400m')),
    experience_level VARCHAR(20) CHECK (experience_level IN ('beginner','intermediate','advanced')),
    personal_best_seconds NUMERIC(6,2),
    -- Consent & Liability (Prompt 2)
    date_of_birth DATE,
    consent_given_at TIMESTAMPTZ,
    consent_version INTEGER NOT NULL DEFAULT 0,
    parental_consent BOOLEAN NOT NULL DEFAULT FALSE,
    drill_intensity_cap VARCHAR(20) CHECK (drill_intensity_cap IN ('moderate','full')),
    is_injured BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    s3_key TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','failed')),
    movenet_version VARCHAR(50),
    overall_score SMALLINT CHECK (overall_score BETWEEN 0 AND 100),
    result_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_analyses_pending ON analyses(created_at) WHERE status = 'pending';

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('workout','rest','competition','drill')),
    scheduled_date DATE NOT NULL,
    details JSONB,
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','completed','skipped','modified')),
    completion_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calendar_user_date ON calendar_events(user_id, scheduled_date);
```

---

## 3. What is Already Done (Fully Completed Features)

### A. Mobile Frontend UI, UX & Animations (`apps/mobile`)
1.  **Visual Palette & Styling**: A premium dark UI built around custom background colors (`#050508`), accent red (`#FF453A`), gold warnings (`#FF9F0A`), and green metrics (`#30D158`), strictly using Harmonious custom gradients and responsive spacing.
2.  **Analysis Detail Screen (`analysis.tsx`)**:
    *   Dynamic scale springs for touch buttons to prevent clunky taps.
    *   Stateful, gorgeous loading transitions with glowing pulsing SVG radar scanning indicators (`Scan` from Lucide).
    *   Glassmorphic overlay cards displaying numeric joint scores, plain-English bio-issue explanations, optimal vs measured parameters (e.g. 82.5° vs optimal 90°-95°), corrective drills, and direct CTAs to the AI coach.
    *   **Disclaimer text** with `accessibilityLabel="analysis-disclaimer"` for legal compliance.
    *   **Injury toggle** (`testID="injury-toggle"`) → recovery-only view with `accessibilityLabel="recovery-mode-notice"`.
3.  **Active Calendar & Schedule Screen (`calendar.tsx`)**:
    *   Horizontal scrollable day selector strip with scale spring feedback.
    *   Custom checkable workout cards with fluid animated state switches (leveraging React Native `Animated`).
    *   Database completion toggling (synchronizing status and notes directly to the PostgreSQL instance).
    *   "Active Rest Day" fallback view containing custom single-tap options to quickly append specific drills to the date.
4.  **AI Expert Coach Screen (`coach.tsx`)**:
    *   Conversational interface dynamically seeded by target video analysis IDs.
    *   Automatic analysis loading, context awareness, typing loaders, and quick question chips (e.g., *Fix Knee Drive*, *Explain A-Skips Cues*).
5.  **Consent & Onboarding Flow**:
    *   Consent screen (`consent.tsx`) with Terms + Medical Disclaimer checkboxes (both required), DOB input, minor detection with parental consent gate.
    *   Profile setup screen captures event specialty, experience level, personal best.
6.  **Unified State & Service Layers**:
    *   Zustand store (`useStrideStore`) caching baseUrl, JWT tokens, consent state, injury flag, and drill intensity cap.
    *   Modular API Client (`services/api.ts`) managing users, upload url presigning, finalizations, chat messages, calendar scheduling, consent recording, and injury status.

### B. Node Express API Backend (`apps/api`)
1.  **Supabase Auth Integration**: Full middleware intercepting tokens, parsing payload details, and loading matching local Postgres records based on `supabase_uid`.
2.  **Consent & Liability Middleware**: `requireConsent` blocks analysis requests with 403 `CONSENT_REQUIRED` or `CONSENT_OUTDATED` until the user has accepted the current version. Age calculation handles year boundaries and leap years.
3.  **Multipart Video Upload Architecture**: Route definitions for `/videos/upload-url` (presigning multi-part S3 chunks) and `/videos/finalize` to safely assemble video uploads without memory exhaustion on base servers. Both routes require consent.
4.  **Automated Calendar Sync in AI Conversations**:
    *   When the coach responds to a user message, the API analyzes the response text for recommended training/recovery drills.
    *   Directly structures these recommendations into concrete PostgreSQL calendar events (`calendar_events`), aligning the athlete's training timeline automatically.
5.  **Database Sweep Cron**: Standard `/lib/sweep.ts` cron pattern clearing out orphaned database uploads and managing stale queue processing states.

### C. Pose Estimation & ML Pipeline (`apps/ml-worker`)
1.  **MoveNet Integration (`movenet.py`)**: Automatic retrieval and inference routines using MoveNet SinglePose Thunder v4. Converts standard MP4 uploads into frame-by-frame joint coordinates.
2.  **Angle Calculation Engine (`biomechanics.py`)**: Math module evaluating hip extension, knee drive, and foot strike contact angles.
3.  **GEMINI 1.5 Flash Parser (`llm.py`)**:
    *   Uses Python's official `google-genai` SDK.
    *   Strict schema enforcement using Pydantic v2 to return pure JSON feedback with zero conversational chat filler.
4.  **Quality Control Shield (`worker.py`)**: Automatically monitors camera confidence. If >40% of the video frames display low keypoint confidence (e.g. due to lighting or camera occlusion), it raises a clean `low_confidence_video` error report.

---

## 4. Product Backlog (Ordered by Priority)

```
┌─────────────────────────────────────────────────────────────┐
│                 PRODUCT ROADMAP BACKLOG                     │
├──────────────────────────────┬──────────────────────────────┤
│ 1. Constrained Workflow UI   │ 2. SSE Worker Progress       │
│ - Action chips (5 per result)│ - Real stage labels          │
│ - Session sealing 24h        │ - Connection auto-close      │
│ - No free-text on analysis   │ - Already-completed fast path│
├──────────────────────────────┼──────────────────────────────┤
│ 3. Reference Drills Layer    │ 4. Longitudinal Metrics      │
│ - reference_drills seed table│ - metrics_timeline table     │
│ - Demo video tile per drill  │ - Progress screen line chart │
│ - Contraindication warnings  │ - Trend in coach context     │
├──────────────────────────────┼──────────────────────────────┤
│ 5. Approval Gate for Calendar│ 6. Skeleton Video Overlay    │
│ - suggestion_audit table     │ - expo-av + SVG keypoints    │
│ - [Add to my plan]/[Skip] UI │ - Frame scrubbing            │
│ - 7-day sweeper for pending  │ - Angle readouts on overlay  │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 5. Architectural Data Payload Formats

### ML Worker to Express SSE / Completed API format
Once the python ML worker finishes, it pushes a PATCH request to the Express API with the following Pydantic-validated payload structure:

```json
{
  "movenet_version": "singlepose-thunder-v4",
  "overall_score": 82,
  "score_label": "Dynamic acceleration setup. Noticeable hip collapse at toe-off.",
  "primary_issues": [
    {
      "rank": 1,
      "type": "low_knee_drive",
      "severity": "high",
      "measured_value": "81.2 degrees",
      "optimal_range": "90 to 95 degrees",
      "plain_english": "Your lead thigh is dropping early, reducing vertical flight time and restricting horizontal stride length.",
      "timeline": "2-3 weeks",
      "drills": [
        {
          "name": "Knee Drive A-Skips",
          "volume": "3 sets of 20 meters",
          "cue": "Punch lead foot down directly under hip center"
        }
      ]
    }
  ]
}
```

### Express to Mobile Calendar Event payload
The calendar events returned from the API conform to the database schema:

```json
[
  {
    "id": "e391b151-512c-4734-91b3-461b24bf2002",
    "title": "A-Skips Corrective Session",
    "event_type": "drill",
    "scheduled_date": "2026-05-24",
    "status": "scheduled",
    "details": {
      "volume": "3 sets of 20 meters",
      "cue": "Punch lead foot down directly under hip center"
    },
    "completion_note": null
  }
]
```

---

## 6. Per-Prompt Test Requirements (v2.1 Replacements)

### PROMPT 1.2 — Constrained Workflow UI
*(Replace Open-Ended Chat with Constrained Workflow)*

> **Note:** Use the `design-taste-frontend` skill when designing all UI components in this prompt.

**Unit tests:**
- Action chip handlers fire correct events
- Session sealing logic: 24-hour inactivity timer correctly closes `analysis_workflow` sessions
- "Why is this an issue?" handler does NOT make an LLM call (assert by mocking the LLM client and confirming zero invocations)

**Integration tests:**
- After completing an analysis workflow, POST attempts to `/coach-sessions/:id/message` with `session_type='analysis_workflow'` and `status='closed'` → 409 conflict
- Free-form `/coach` surface (`session_type='free_coach'`) accepts messages normally
- Confirm zero `calendar_events` rows created during the entire analysis workflow (assert COUNT before and after)

**E2E (Detox):**
- Upload video → wait for analysis → see exactly 5 action chips (assert by testID) → no free-text input visible on analysis screen
- Tap "Mark as understood" → banner "Analysis complete" appears → action chips disappear
- Navigate to Coach tab → free-text input IS visible and works
- Throughout the entire flow, verify NO calendar event is auto-created (call test API helper to assert event count)

**Vision retention check items affected:** #2 (AI detaches), #3 (no auto-calendar), #6 (Coach tab separate).

---

### PROMPT 1.3 — Correct Form Demonstration Layer
*(Reference Drills)*

> **Note:** Use the `design-taste-frontend` skill when designing the side-by-side drill demo tile layout.

**Unit tests:**
- Pydantic validator rejects `drill_key` values not present in `reference_drills` seed
- LLM hallucinated drill name → validator raises with specific error message
- Reference drill lookup returns 404-equivalent for unknown keys

**Integration tests:**
- Seed the `reference_drills` table with 10 known drills → run an analysis → verify the response only contains drills from the seeded set
- Force an LLM response with a hallucinated drill key (via mock) → API returns 500 with structured error logged → `analyses.status = 'failed'`
- `GET /reference-drills/:key` returns the demo video URL, cues, and contraindications

**E2E (Detox):**
- Open an analysis result → for each recommended drill, the demo video tile is visible alongside user's own video (assert side-by-side layout testIDs)
- Tap demo video → it plays
- A drill with contraindications shows a warning before the user can mark "I'll try this"

**Vision retention check items affected:** #4 (visual demos present).

---

### PROMPT 2.2 — SSE Worker Progress

**Unit tests:**
- Each progress event is correctly serialized as `event: <stage>\ndata: <json>\n\n`
- Terminal events (`'complete'`, `'failed'`) trigger connection close
- Heartbeat is NOT emitted (vision says AI detaches; no keep-alive)

**Integration tests:**
- Subscribe to `GET /analyses/:id/progress` while a real ml-worker processes a real test video on LocalStack
- Assert events arrive in order: `queued → downloading → pose_extraction → biomechanics_calculation → llm_structuring → finalizing → complete`
- Connection closes within 1 second of terminal event
- Subscribing to an already-completed analysis returns the final state and closes immediately

**E2E (Detox):**
- Upload video on mobile → progress bar shows real stage labels in order, not a fake spinner
- Progress bar advances visibly (assert label changes at least 3 times)
- On `'complete'`, screen auto-navigates to results within 2 seconds

**Vision retention check items affected:** #1 (fast feedback under 60s), #2 (AI detaches — connection closes).

---

### PROMPT 3.1 — Longitudinal Metrics

**Unit tests:**
- After completed analysis, `metrics_timeline` rows are created for each tracked metric
- Trend calculation: given 4 weeks of data, "improved by X°" calculation is mathematically correct
- Training load calculation handles edge cases (zero events, all skipped, etc.)

**Integration tests:**
- Run 3 sequential analyses for the same user → verify `metrics_timeline` has 3 entries per metric
- Coach LLM prompt context block contains the last 3 metrics (assert by capturing the prompt string passed to Gemini in a test double)
- Progress screen API: `GET /users/me/metrics` returns last 30 days grouped by `metric_key`

**E2E (Detox):**
- Run two simulated analyses on a seeded user (via test API) → open Progress screen → line chart shows 2 data points per metric
- Optimal range threshold band is visible on the chart
- Open Coach tab → ask "how am I doing?" → response references the trend (assert via fixture/mocked Gemini response)

**Vision retention check items affected:** #7 (Progress screen functional).

---

### PROMPT 3.2 — Approval Gate for Calendar Writes

**Unit tests:**
- `POST /suggestions/:id/approve` → writes to `calendar_events`, writes to `suggestion_audit` with `action='approved'`
- `POST /suggestions/:id/skip` → no `calendar_events` row, `suggestion_audit` with `action='skipped'`
- Approving the same suggestion twice → idempotent (no duplicate `calendar_events`)
- Bad date input → 400, no rows touched

**Integration tests:**
- Trigger full analysis pipeline → verify response contains `suggestions` array with NO `calendar_events` created
- Approve 2 of 4 suggestions → exactly 2 `calendar_events` created
- Audit log captures all 4 (2 approved, 2 implicit skips after 7 days via sweeper)

**E2E (Detox):**
- Complete an analysis → see 3 drill suggestions, each with [Add to my plan] / [Skip] buttons
- Tap [Skip] on one → it disappears, no calendar event
- Tap [Add to my plan] on another → date picker appears → confirm → navigate to Calendar tab → event is there
- Final assertion: total `calendar_events` count matches user's explicit approval taps

**Vision retention check items affected:** #3 (no auto-calendar — strict).

---

## 7. New Testing Prompts (T.1, T.2, T.3)

### PROMPT T.1 — Build the End-to-End Testing Foundation

Before any of the feature prompts can satisfy their test rider, the testing infrastructure must exist. Build it.

**Tasks:**

1. **Test database & infrastructure** (`docker-compose.test.yml`):
   - Postgres on a separate port from dev
   - LocalStack with S3 + SQS pre-configured
   - Wait-for-it scripts so tests don't race the containers
   - Single command `pnpm test:env:up` and `pnpm test:env:down`

2. **apps/api test harness**:
   - Jest configured with a test database that gets schema-migrated and truncated between describe blocks
   - Supertest for HTTP integration tests
   - A `tests/helpers/factories.ts` with factory functions: `createTestUser({ consented: true })`, `createTestAnalysis({ status: 'completed' })`, `createTestSuggestion()`, etc.
   - An `auth-helper.ts` that mints a valid Supabase-shaped JWT for a test user
   - A `db-helper.ts` with `truncateAll()`, `seedReferenceDrills()`, `assertNoCalendarEventsCreated()`, etc.

3. **apps/ml-worker test harness**:
   - Pytest with fixtures for LocalStack SQS/S3
   - A `conftest.py` that boots a fresh queue per test
   - Mocked Gemini client that can be programmed with canned responses per test
   - A `fixtures/videos/` folder with at least 3 small test videos (lateral, 45°, head-on) — committed to LFS or stored in a fixtures bucket

4. **apps/mobile test harness**:
   - Detox or Maestro configured for iOS Simulator AND Android emulator
   - A test mode flag that points the app at a local API (loopback)
   - MSW for integration-level mocking when E2E is overkill
   - testIDs added to every interactive element in screens we'll write tests against (consent screen, analysis result, action chips, suggestion cards, Progress chart, Coach input)

5. **Shared E2E orchestrator** (`packages/test-orchestrator`):
   - A single script `pnpm e2e:full` that:
     a. Spins up docker-compose.test.yml
     b. Runs DB migrations
     c. Seeds reference_drills
     d. Starts apps/api and apps/ml-worker in test mode
     e. Boots iOS simulator with the app
     f. Runs Detox suite
     g. Tears everything down
   - Output is a single pass/fail and a junit XML report

6. **CI configuration**:
   - GitHub Actions workflow `ci.yml` that runs on PRs:
     - lint
     - typecheck
     - unit tests (parallel per app)
     - integration tests (with services)
     - E2E tests (iOS only on CI to start; nightly Android)
   - PRs cannot merge with red CI

---

### PROMPT T.2 — Vision Retention Automated Suite

The vision retention check was a manual checklist. Convert it to an automated E2E suite that runs in CI on every PR.

**Tasks:**

1. Create `apps/mobile/e2e/vision-retention.e2e.ts` with 7 tests, one per vision check:

   **TEST V1 — Fast structured feedback under 60 seconds**
   - Sign in as a pre-consented test user
   - Upload a small pre-recorded test video (committed fixture)
   - Start a timer
   - Wait for analysis results to render
   - Assert elapsed time < 60,000 ms
   - Assert results contain structured fields (overall_score, primary_issues, drills)

   **TEST V2 — AI detaches after analysis**
   - Complete an analysis
   - Wait 1 second after results render
   - Assert: free-text chat input is NOT present on the analysis screen
   - Assert: the SSE progress connection is closed (check via API health endpoint that exposes active SSE count for this user)
   - Tap the "Mark as understood" chip
   - Assert: the analysis workflow session row in DB has `status='closed'`

   **TEST V3 — No auto-calendar writes**
   - Snapshot `calendar_events` count for the test user
   - Complete an analysis with 3 drill suggestions
   - Do NOT tap any [Add to my plan] button
   - Assert: `calendar_events` count is unchanged
   - Approve exactly 1 suggestion
   - Assert: `calendar_events` count increased by exactly 1

   **TEST V4 — Visual demonstrations of correct form**
   - Complete an analysis with at least 1 drill recommendation
   - On the result screen, for each drill, assert:
     - testID `drill-demo-video-<key>` is visible
     - testID `drill-user-video-<key>` is visible
     - They are arranged side-by-side or stacked but both present

   **TEST V5 — Disclaimers and consent gates**
   - Fresh install + new user → cannot reach upload screen without completing consent
   - On the analysis result, assert testID `medical-disclaimer` is visible
   - "I am injured today" path → assert no sprint drill cards are visible

   **TEST V6 — Coach surface is distinct**
   - From analysis result screen, assert: no path leads directly into a free-form chat
   - Navigate to Coach tab via main nav → assert: free-text input IS present
   - Assert: Coach tab is reachable only via main nav, not auto-routed from analysis

   **TEST V7 — Progression visible**
   - Seed test user with 2 prior analyses (via test API)
   - Navigate to Progress screen
   - Assert: line chart renders with at least 2 data points per metric
   - Assert: optimal range band is visible

2. CI integration: this suite is BLOCKING on every PR. If any of V1-V7 fail, PR cannot merge.

3. Add a per-build "Vision Retention Badge" in the README that reflects the latest main-branch status.

4. Each test failure produces a screenshot + video saved to CI artifacts for 30 days.

---

### PROMPT T.3 — Continuous Verification Cron

The vision can drift silently between PRs. Add scheduled verification that runs against staging.

**Tasks:**

1. Create `.github/workflows/nightly-verification.yml`:
   - Runs at 04:00 UTC daily against staging environment
   - Executes the full Vision Retention suite (T.2)
   - Executes the Biomechanics Validity check (Prompt 0.3) on a fresh set of 3 canonical test videos
   - Captures: end-to-end latency for upload→analysis (P50, P95, P99), measured via real upload to staging
   - Posts a Slack/Discord notification on any regression

2. Create `apps/api/scripts/health-audit.ts`:
   - Connects to staging DB (read-only role)
   - Reports:
     - Count of analyses stuck in 'processing' for >10 minutes (anomaly)
     - Count of `calendar_events` created without a corresponding approved `suggestion_audit` row (vision violation!)
     - Count of `coach_sessions` of type `'analysis_workflow'` open >24 hours (cleanup bug)
     - Average pose detection confidence across analyses in last 24h (quality drift detector)
   - Runs nightly. Threshold violations open a GitHub issue automatically.

3. Add a `STATUS.md` to the repo root that the nightly cron updates with:
   - Last vision retention run result + timestamp
   - Last biomechanics validity result
   - Latest staging latency percentiles
   - Open issues count by severity

---

## 8. Acceptance Criteria (v2.1 — Strict)

Stride v1 is shippable when ALL of the following are true:

- Universal Test Rider has been satisfied for every prompt that introduced new code
- T.1 testing foundation is in place; `pnpm e2e:full` returns green
- T.2 Vision Retention suite is green; all 7 tests pass on main
- T.3 nightly verification has run successfully for 7 consecutive nights with no regressions
- CI gates: PRs cannot merge without lint + typecheck + unit + integration + E2E green
- Biomechanics validity (Prompt 0.3) is proven OR documented mitigations are tested
- Per-app test coverage: ≥70% lines on `apps/api` and `apps/ml-worker`, ≥60% on `apps/mobile` (with the Vision Retention suite mandatorily green regardless of coverage %)
- Manual exploratory test pass by a human on a real device, documented in `docs/test-evidence/MANUAL_PASS.md`
- All audit findings from Prompt 0.1 either resolved or explicitly accepted (with reason) in `docs/decisions/`

> **Coverage % alone is not acceptance.** A 95%-coverage test suite that doesn't exercise the vision retention checks is meaningless. The Vision Retention suite is the contract.

---

## 9. Order of Operations (v2.1)

The corrected sequence for Claude Code is:

1. **Prompt 0.1** — Audit (no tests; audit only)
2. **Prompt T.1** — Build test foundation (do this BEFORE any feature work; the rider depends on it)
3. **Prompt 0.2** — Smoke test (now uses the harness from T.1)
4. **Prompt 0.3** — Biomechanics validity
5. **Prompt T.2** — Vision Retention suite (write it before vision-realignment work so we have measurable regression detection)
6. **Prompts 1.1, 1.2, 1.3** — Vision realignment (each with rider applied; use `design-taste-frontend` skill for all UI)
7. **Prompts 2.1, 2.2** — Reliability
8. **Prompts 3.1, 3.2, 3.3** — Long-term coach layer
9. **Prompt T.3** — Continuous verification (turn on after main features land)
10. **Prompt 4.1** — Original v1 backlog
11. **Prompt 5.1** — Manual vision retention check pre-release

---

## 10. PRD v2 Postmortem — What Was Wrong

Honest postmortem of PRD v2's testing gaps:

- **Inconsistency**: Prompts 0.2, 0.3, 2.1 had decent test coverage. Prompts 1.1, 1.2, 1.3, 2.2, 3.1, 3.2 had loose or missing test sections.
- **No shared foundation**: Each prompt's tests assumed infrastructure that didn't exist yet (no test harness specified upfront).
- **Vision check was manual**: The single most important check (does the app still match the vision) was a human checklist, not automated, so it would silently rot.
- **No CI gate**: No mechanism to prevent merging code that broke the vision.
- **No staging verification**: Nothing watched the deployed app between releases.

v2.1 fixes all five.

---

## 11. Universal Test Rider

Before marking any prompt complete, ALL of the following must be satisfied:

1. **UNIT** — Add or update unit tests for any new function/class. Run the full unit suite. Zero failures.
   - `apps/api`: Jest. Target: every new route handler, middleware, and DB query function has at least one test.
   - `apps/ml-worker`: Pytest. Target: every new module function has tests; mock external services.
   - `apps/mobile`: Jest + React Testing Library. Target: every new component renders without throwing; state-changing logic has a test.

2. **INTEGRATION** — Add at least one integration test that exercises the new code through its real boundary.
   - API: spin up a real Express server against a real Postgres (use docker-compose test profile); hit the actual HTTP endpoint.
   - Worker: enqueue a real SQS message to LocalStack; verify the worker processes it correctly end-to-end.
   - Mobile: render the screen with mocked API responses via MSW (Mock Service Worker); assert the UI reflects the data.

3. **E2E** — Add or update at least one Detox (or Maestro) end-to-end test that simulates a real user flow touching this feature on a device/simulator. If the feature is purely backend, add an E2E API test using a script that walks through the full upload→analysis→retrieve cycle with the new behavior exercised.

4. **VISION RETENTION** — Run the seven-point vision retention checklist (Prompt T.2) against the app after your changes. Document any regression. If any of the seven checks fail, you have introduced a regression and must fix it before completing this prompt.

5. **EVIDENCE** — Produce a file `docs/test-evidence/PROMPT-<id>-EVIDENCE.md` containing:
   - Test commands run and their output (or links to CI runs)
   - Screenshots/videos of the E2E test if mobile-facing
   - The vision retention checklist results
   - Any test you deliberately skipped, and why

---

*PRD v2.1 — Updated for rigorous testing foundation. Stride Athlete platform state: ACTIVE DEVELOPMENT. Last updated: 2026-05-25.*
