# Stride UI redesign / 2026-10-07

## Phone-feedback refinement

- Replaced the text-only rail with a floating five-icon dock. One-line labels retain automation IDs; a gold-tinted lens follows horizontal dragging and commits navigation only on release. Taps, long presses, prevented tab events, and cancelled drags remain supported. Analysis highlights Progress without adding a sixth tab.
- iOS uses a thin native blurred material, deliberately confined to the dock. Reduce Transparency and other platforms use a solid tonal fallback; Reduce Motion removes spring movement. Screens reserve dock clearance, including the separately maintained coach composer. Keyboard input and live capture hide the dock.
- Live capture is full-bleed with a single safe-area inset, branded controls, curved gold framing guides, a toggleable guide, direct library access, and a real elapsed-time shutter ring. The guide is instructional, not body detection. Recording retains the existing camera, sensors, duration limit, target selection and upload flow; library access is disabled while recording. Leaving capture cancels/discards its recording.
- Removed the oversized uppercase Progress eyebrow. Streaks now live inside the calendar: continuous server-derived ribbons, completed-day checks, selected-date circles and a shared current/best summary in week and month views. Scheduled work does not count as adherence.
- The user's separate coach/orb/logo work and dependency changes remain preserved. The blue cog from the phone screenshot is not changed.

Automated follow-up: 31 suites / 163 tests passed, mobile TypeScript passed, token compilation passed, and web/iOS Hermes exports passed. These checks do not establish on-device glass fidelity, camera framing, VoiceOver, or drag ergonomics; native visual review remains required because `simctl` is unavailable and the prior local-browser review was declined.

## Research evidence

Before code, inspected live Refero screenshots of [Opal](https://refero.design/apps/76), [Lumy](https://refero.design/screens/7d6de391-d210-4cee-8bbe-ed9a139e5209), [Endel](https://refero.design/apps/12), [Loóna](https://refero.design/apps/11), [Imprint](https://refero.design/screens/74cb4451-31b4-4279-ae99-24ec1f61a5fb), and [Cosmos](https://refero.design/screens/d28f4e19-d9ad-40f3-b888-b9a271d36ba5). Opal/Endel/Loóna exposed eight free screens; hidden paid screens were not reviewed. Browser access to Flighty styles and Flighty's website was declined: no exact Flighty tokens were extracted. Local preview access was also declined, so no screenshot review or before/after parity claim is made. simctl is unavailable on this computer.

| Reference | Actual inspectable properties | Integration |
| --- | --- | --- |
| Opal | Black stage, compact auth fields, low full-width action, white high-contrast headline | Auth stage; capture scene and circular record control |
| Lumy | Curved upper graphic joined to compact lower data rows; hairline separators; selective colored readouts | Film instrument, temporal trace, chart-led progress |
| Endel | Thin mathematical outlines; one large visual above one explanation; minimal chrome | Illustrative lanes and truthful processing state |
| Loóna | Continuous deep background; short focused headline; low-anchored primary action | Entry composition and video-first recording |
| Imprint | Explanation above diagram, one idea at a time, slim progress indicator, quiet secondary toolbar | Expandable measurements, safety checklist, coach briefing, drill details |
| Cosmos | Media carries hierarchy; varied gallery rhythm; typography and quiet captions | Session archive and editorial coaching home |
| Flighty | Brief-required hierarchy only; access denied | Compact grouped settings and tabular instruments; not a verified token extraction |

Default worker is 2D RTMPose at 15 Hz with dual-rate ankles and gravity support (`apps/ml-worker/src/worker.py`). Optional 3D code exists but is not evidence for synthetic depth. Live UI uses the athlete's actual film and 2D overlay. No fabricated scores or synthetic pipeline progress.

## System

Canonical tokens: `packages/design-tokens/src/tokens.ts`. Preserve original C8A140 gold. Light is mineral ivory/porcelain with deep green-black media. Dark is independently chosen green-charcoal with champagne readouts. Native UI typography avoids unloaded legacy font families: 42/32 editorial, 28/20 heading, 15 body, 12 caption, 10 micro-label; tabular numerals. Editorial density 24 gutter/32 section; instrument 16/16. Radii 10 controls, 18 panels, 28 sheets, circular only for circular controls. Hairline separators, quiet tonal grouping; no card grid. Shared screen/header/button/field/segment/sheet vocabulary. Persisted light/dark/system and reduced-motion settings. Primary controls have 44-point minimum targets and human-readable labels distinct from automation IDs. Compact month cells and larger accessibility text still require native review. Charts and overlays use real data only. Metro and browser exports consume token source directly, avoiding stale compiled palette files during development; Node consumers keep the compiled package entry.

## Inventory and design decisions

Source inspection covers all routes/components/states below. Old screens could not be screenshotted because local browser access was declined. Each row contrasts two structural alternatives, not colors.

| Screen and states | Intent / three old problems | Alternatives | Choice and primary reference |
| --- | --- | --- | --- |
| Login/register/error/email confirmation | Enter account; plain form stack, weak identity, detached actions | Cinematic cover then sheet / split stage and fields | Split editorial entry, Opal/Loóna |
| Consent/minor/API failure/legal reader | Review safety; oversize box, duplicate toggles, legal density | Wizard / readable checklist with reader | Checklist, Imprint; mandatory server consent |
| Athlete setup/profile edit/PB/error | Set context; uniform chips, long form, no hierarchy | Survey / numbered identity/event/experience | Editorial sections, Imprint |
| Capture/permission/import | Film a run; empty placeholder, rectangular CTA, ambiguous high-fps copy | Immediate permission wall / preview stage and shutter | Stage + shutter, Opal/Loóna |
| Live recording/stop/cancel/limit | Frame athlete; no timer, weak guides, unsafe cancel | Perimeter instruments / overlay card | Perimeter + real elapsed time, brief's Flighty hierarchy |
| Target/video preview/trace/reset/cancel | Select athlete; isolated title, no exit, no scrub | Video toolbar / side instructions | Video first, Cosmos |
| Upload/pending/retry/error | Transfer; spinner only, lost clip, misleading analysis stage | Fake percent / real status and retained clip | Real request state, Endel |
| Analysis queue/processing/retry/error | Await report; bare spinner, no exit, dead-end error | Status card / observatory and exit | Observatory, Endel |
| Results overview/measurements/practice | Read evidence; synthetic target, guessed score, endless metrics | Grid / film plus content lenses | Film + three lenses, Lumy/Imprint |
| Recovery status/check failure/update failure | Train safely; missing recovery path, unconfirmed switch, sprint suggestions during injury | Optimistic switch / server-confirmed preference | Confirmed preference; pause prescriptions while status is unknown or injured |
| Video/overlay/frame step/joint/trail/curve | Inspect movement; red hardcoding, static knee, no curve | Detached pose / integrated instrument | Synced real 2D video instrument, Endel/Lumy |
| Metric/confidence/withheld/detail | Explain values; no drilldown, trust unclear, bands absent | Inline dump / progressive evidence rows | Expandable rows, Imprint |
| Drill detail/missing media/approve/skip/error | Act; inert play icon, lost reasoning, swallowed failures | Fake gallery / dose and rationale | Editorial prescription, Imprint; honest missing-media state |
| Progress empty/history/insights/error | Track change; heuristic scores, repeated cards, error as empty | Dashboard / chart-led archive and baseline journey | Chart + archive, Lumy/Cosmos |
| Session detail/comparison | Revisit evidence; score-only sheet, no report link, no comparison | Static score / evidence and navigation | Shared sheet + gated comparison, Imprint |
| Coach home/no-data/latest/error | Contextual advice; five chips, no priorities, fake thought steps | Chat only / briefing with conversation layer | Real briefing + conversation, Imprint/Cosmos |
| Coach thread/loading/failure/scheduling | Ask anything; generic bubbles, fake reasoning, weak busy states | Rich cards / editorial responses | Editorial responses + truthful wait, Imprint |
| Plan today/week/month/rest/completed/error | Know next action; month-first, no weekly scan, hidden errors | Calendar focus / today then weekly rail | Today/week; month secondary, Flighty brief |
| Event detail/future/backfill/completion | Inspect and log; plain sheet, invisible completed state, failed-write optimism | Instant checkbox / dose/cue sheet | Shared sheet; server-confirmed completion, Imprint |
| New plan reveal/review/dismiss | Inspect scheduled work; gesture-only, inaccessible, giant blank date | Fanned deck / chronological explicit review | Chronological review, Imprint |
| Streak/month | See adherence; theatrical badge, color clashes, dense legend | Streak graphic / compact rail | Compact rail and calendar, Flighty brief |
| Settings/appearance/accessibility/privacy | Manage account; sparse boxes, no system mode, no persistence | Dashboard / compact grouped list | Quiet grouped list, Flighty brief |
| Sign-out/delete/error | Confirm; unreliable web alert, no busy guard, weak context | Native alerts / shared confirmation | Explicit confirmation sheet |
| Root hydration | Restore; bare spinner, no identity, no accessible status | Blank / branded restore state | Shared loading language, Endel |

## Validation ledger

Implementation is not visual verification. Camera permissions, capture, native gestures, real API uploads/auth/coach, both-theme screenshots, and side-by-side fidelity require runtime access. No complete visual acceptance claim until these are actually reviewed. Automated results are recorded after implementation.

### Checks completed

- Mobile TypeScript: `npm run ts:check --workspace=@stride/mobile` passed.
- Mobile Jest: 30 suites, 152 tests passed. Coverage includes auth/consent, capture ready/permission/cancel/import/retry, analysis loading/failure/approval, measurement disclosure/trust, coach context/request locking/retry/scheduling, plan completion/review, recovery confirmation, destructive account confirmation, persisted themes, and WCAG AA semantic text pairs. API/native modules are mocked: this is not live end-to-end validation.
- Design-token package compilation passed. Source conditions keep Metro/Jest on the current canonical tokens.
- Web Expo export passed; output `/tmp/stride-ui-web`.
- iOS Hermes bundle export passed; output `/tmp/stride-ui-ios`. This is JavaScript/assets compilation, not an Xcode build, simulator launch, or device run.
- `git diff --check` passed.
- Scoped lint command ran but executed zero tasks: mobile/design-tokens have no configured lint script. Do not report this as lint coverage.

### Behavior safeguards

- Existing auth, video upload/manifest, LAN API resolver, polling, history, plan, consent and coaching integrations remain. Capture failures retain the original clip and selected target. No new worker or fake backend was introduced.
- Missing composite scores remain unavailable; no severity-derived replacement is shown. Trust uses the existing validation fallback, confidence, finite values, and capture usability. Comparisons require matching phase/pipeline/unit and do not label numerical change as proven performance improvement.
- Injury preference is read from the server. Unknown or injured status pauses sprint prescriptions; failed updates do not optimistically change the switch.
- Coach replies show actual request waiting, not invented thought stages. Scheduling passes the real conversation, requires explicit approval, and handles failure independently from message retry.
- Sign-out/deletion require confirmation; failed deletion preserves identity. Successful deletion clears the local session even if remote revocation is unavailable.
- Superseded tracked UI components were removed. Existing untracked FormTargetView/formTargetPose experiments are retained but never imported by shipping routes. Separately added Skia/thinking-orbs dependencies/vendor files are preserved at the user's explicit request.

### Remaining acceptance work

| Review | Status / required evidence |
| --- | --- |
| Before/after screenshots, every route in both themes | Not produced: local browser preview was declined; no simulator is installed |
| Native camera/import/target tracing/video scrubbing/IMU | Not exercised on a device; mocked regression coverage only |
| Live authenticated API/worker/coach/plan persistence | Not exercised; requires running API and a consented test account with real clips |
| Small phones/tablets, 200% text, VoiceOver, keyboard and OS reduce motion | Native visual/interaction review still required |
| Reference fidelity pairs and weakest-screen iteration | Pending runtime screenshots; six Refero screenshot references reviewed, Flighty access declined |
| Drill demonstration playback | Existing APIs contain no available demonstration media; show an honest unavailable state instead of simulated demonstrations |

The tracked Maestro flows now use the actual bundle identifier and current route/automation IDs. `.maestro/ui_redesign_smoke.yaml` and its helper collect light/dark route and sheet screenshots on an installed native build with `EMAIL` and `PASSWORD` supplied by the operator. They are prepared but **not run**. Use a dedicated, pre-consented test account; populated analysis screenshots need existing real analysis history. The flow changes that test account's appearance preference and dismisses any already-scheduled plan review, but never approves a new program or completes a workout.

Command syntax was checked against Maestro's official [inputText](https://docs.maestro.dev/reference/commands-available/inputtext), [runFlow](https://docs.maestro.dev/reference/commands-available/runflow), and [extendedWaitUntil](https://docs.maestro.dev/reference/commands-available/extendedwaituntil) documentation. Maestro CLI is not installed here; YAML parsing is not an on-device test.

For runtime review, start the existing local stack with `./scripts/dev-up.sh`, connect the native client through the current LAN path, and run `maestro test .maestro/ui_redesign_smoke.yaml` with test credentials supplied as Maestro environment variables. Browser visual review requires reauthorizing the previously declined local preview. Until those passes happen, this deliverable is an implemented redesign with automated validation, **not a completed visual sign-off**.
