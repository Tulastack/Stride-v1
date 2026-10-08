# STRIDE: Full Mobile UI Redesign, Built in the Design Language of Our References

## 0. Read This First: What This Task Is

This is a **ground-up redesign of the entire Stride mobile app**. It is not a reskin, a theme update, a component refresh, or a polish pass.

You are replacing the app's visual language, layouts, information architecture, navigation, components, typography, motion, and screen states. Every screen will be rebuilt. The current UI is a reference for **what the app does**, not for **how it should look or be structured**.

The finished app must look like it belongs in the same tier as the seven reference products below (Opal, Lumy, Endel, Loóna, Imprint, Flighty, Cosmos). A designer browsing Refero should be able to place a Stride screenshot next to those apps and see a product of the same craft level and design family, while still recognizing it immediately as Stride (gold, warm, athletic, scientific).

### What does NOT count as completing this task

The task is not done if any of the following are true:

- A redesigned screen keeps the same layout skeleton as the old one (same vertical stack, same header, same block order) with new colors, fonts, or radii applied.
- Old components are restyled in place instead of being replaced by components from the new design system.
- Only the five bottom-nav screens were touched, and nested screens, sheets, modals, onboarding, loading, empty, and error states still use the old UI.
- Light mode was designed and dark mode was produced by inverting it (or vice versa).
- A screen cannot be traced to specific, named properties of at least one reference product.
- Legacy components, styles, or hardcoded colors from the old UI still exist in the codebase and are still in use.

If a person who has used the current app could open a redesigned screen and say "same screen, new paint," that screen is not finished.

### What counts as completing this task

- Every route, screen, sheet, modal, and state has a new layout chosen through explicit reasoning (Section 7).
- A new design system (tokens, type, surfaces, components, motion) exists and every screen is built from it.
- Superseded components and styles are deleted, not left beside the new ones.
- Each screen has a documented mapping to the reference properties it integrates (Section 3), and a side-by-side review against those references (Section 9).
- Both themes are complete, tested, and screenshotted.
- All existing functionality, data, and APIs still work.

---

## 1. Product Context

Stride is an AI-powered running and sprint coaching platform. Mission: give every athlete an all-inclusive coaching staff using only their phone.

The product combines:

- Video-based sprint and running analysis.
- Pose estimation and movement reconstruction.
- About 11 key kinematic and performance metrics.
- Per-metric trust/confidence gating (some metrics are withheld or flagged when measurement quality is low).
- Explainable, personalized feedback.
- AI coaching for technique, training, recovery, and performance.
- Corrective exercises and mobility recommendations.
- Personalized training plans.
- Longitudinal performance tracking.

The core experience should feel like an **intelligent movement laboratory** that is still intuitive and beautiful for everyday high school and collegiate athletes.

### Ground truth about the analysis engine (verify in the repo)

Repository: `github.com/Tulastack/Stride-v1` (monorepo: Express API, Python ML worker, React Native app, Terraform AWS infra). Confirm all of the following against the actual code before designing around it:

- The shipping engine uses **2D keypoints** (RTMPose at roughly 15 Hz), ankle tracking at full frame rate, and IMU gravity-anchored angles where available.
- **Monocular 3D reconstruction is on the roadmap, not shipped.** Design the analysis viewer around real 2D keypoint overlays on the athlete's video. You may design a clearly scoped slot for a future 3D view, but do not render 3D skeletons, fake depth reconstructions, or simulated motion data as if they were real analysis.
- Per-metric confidence exists in the pipeline. Surface it honestly in the UI.

Everything visual that implies measurement must be driven by real data returned by the existing APIs.

---

## 2. Mandatory Reference Research

Before writing any UI code, study the references below directly: actual screenshots, layouts, component hierarchies, type, color, spacing, transitions, and flows. Product descriptions are not enough.

### Access notes

- Refero pages (`refero.design/apps/...`, `/screens/...`, `/ios-apps`) render client-side. A plain HTTP fetch returns only page metadata, not screens. Use a real browser, the Refero MCP (`https://refero.design/mcp`), or both.
- `styles.refero.design` pages expose design tokens. Extract the actual values (type sizes, weights, radii, border widths, color roles, spacing).
- Also study each product's own website, App Store screenshots, and publicly available videos of the app in motion.
- If a reference cannot be accessed, record that in the final report and say exactly what material you used instead. Never claim to have examined a screen you did not see.

### The seven references

**A. Opal** (https://refero.design/apps/76)
Sculptural 3D objects, controlled lighting and depth, iridescent surfaces, atmospheric backgrounds, and how a minimal UI still carries a strong identity. Note how immersive graphics sit beside ordinary controls without competing.

**B. Lumy** (https://refero.design/screens/7d6de391-d210-4cee-8bbe-ed9a139e5209)
Atmospheric gradients, smooth transitions between visual regions, elegant data visualization, organic geometry, density without clutter, refined light and dark surfaces.

**C. Endel** (https://refero.design/apps/12)
Generative visual systems, organic and mathematical forms, spatial composition, dynamic graphics that are functional interface elements, calm distinctive motion, minimal chrome around expressive content.

**D. Loóna** (https://refero.design/apps/11)
Cinematic composition, spatial depth, interactive scenes, lighting, camera movement, fluid transitions between states.

**E. Imprint** (https://refero.design/screens/74cb4451-31b4-4279-ae99-24ec1f61a5fb)
Editorial composition, educational storytelling, interactive diagrams, purposeful illustration, typographic hierarchy, progressive disclosure of complex ideas.

**F. Flighty** (https://styles.refero.design/style/0d0de64c-1891-4984-9e12-8976e042ce11)
Technical precision, dense but legible hierarchy, refined components, high-quality light/dark parity, functional microinteractions, selective color for attention, thin borders, quiet elevation. Extract its tokens carefully: Flighty is the primary reference for Stride's component-level craft.

**G. Cosmos** (https://refero.design/screens/d28f4e19-d9ad-40f3-b888-b9a271d36ba5)
Editorial and asymmetric layouts, beautiful image presentation, typography-led structure, varied spacing rhythm, thoughtful media galleries.

### Additional research

Browse https://refero.design/ios-apps and search Refero for stronger solutions to specific screens (camera capture, video scrubbing, chart detail, onboarding, settings). Look beyond fitness: creative tools, healthcare, photography, data visualization, education, premium productivity.

### Research output

For each reference, write down **concrete, inspectable properties**, not adjectives. Examples of the level of detail expected:

- "Flighty: 0.5pt hairline separators at ~8% opacity; numeric readouts in tabular figures; one accent color per card, used only on the value that changed."
- "Lumy: chart fills fade from accent to transparent over ~60% of height; background gradient shifts hue by section rather than per card."

These properties are what Section 3 integrates into Stride.

---

## 3. Reference Integration: How Stride Should Absorb the References

The goal is integration, not inspiration by vibe. Stride's UI should **visibly share design DNA** with the references: their level of craft, their material and lighting treatments, their typographic discipline, their density, and their motion quality. Specific properties from the references must show up in specific Stride components.

Rules:

1. **Integrate properties, not screens.** Adopt layout principles, surface treatments, type ratios, border and radius logic, chart styling, and motion character. Do not reproduce a reference's full screen, illustrations, iconography, or proprietary assets.
2. **Every Stride screen maps to at least one primary reference** and lists the exact properties it adopts.
3. **Stride's identity stays dominant.** Gold, warm neutrals, and athletic/scientific content are what make a screen Stride. The references shape how those elements are composed and rendered.
4. **The references must agree with each other inside Stride.** Flighty precision, Opal/Loóna depth, and Imprint/Cosmos editorial layout should feel like one system. Section 6 is where that unification happens.

### Starting integration matrix (refine after research)

| Stride area | Primary refs | Properties to integrate |
|---|---|---|
| Capture / recording | Loóna, Opal, Flighty | Full-bleed camera as the scene, not a button on a page (Loóna). A sculptural, lit record control (Opal). Precise status readouts for frame rate, side-on framing, distance, and duration (Flighty). |
| Processing | Endel, Opal | Calm, generative progress driven by real pipeline stages and real frames/keypoints as they are processed. Lighting that carries continuity into results. |
| Analysis results (signature screen) | Opal, Endel, Lumy, Flighty | The athlete's movement as the hero with real keypoint overlays and trajectories (Endel). Angle curves with atmospheric fills (Lumy). Hairline readouts, tabular numerals, confidence indicators (Flighty). Depth and lighting around the viewer (Opal). |
| Metric detail / explanations | Imprint, Flighty | Progressive disclosure, explanatory diagrams, editorial type hierarchy, precise data tables. |
| Progress & insights | Lumy, Flighty, Cosmos | A hero trend visualization, dense comparable session rows, and a video-thumbnail history gallery with editorial rhythm. |
| AI Coach | Imprint, Cosmos | An editorial coaching home built from the athlete's real analyses, with chat as a layer rather than the whole screen. |
| Training plan | Flighty, Imprint, Cosmos | Today's session as a live-status hero (Flighty's status-card logic), a weekly timeline, editorial session detail with media. |
| Drills & exercises | Imprint, Cosmos, Loóna | Media-led pages, step diagrams, immersive demonstration playback. |
| Onboarding & auth | Opal, Loóna | Atmospheric, cinematic first impression that still gets the athlete to their first recording quickly. |
| Settings & account | Flighty | Quiet, compact, native-feeling grouped lists. No dramatic visuals. |

---

## 4. Stride's Visual Identity

Target aesthetic: **Kinetic Editorial + Biomechanics Observatory + Precision Instrument.**

1. **Cinematic:** movement, depth, art-directed media, beautiful transitions.
2. **Human:** warm, approachable, athlete-centered, emotionally engaging.
3. **Scientific:** precise, interpretable, data-rich, trustworthy.

### Brand color preservation

**Preserve Stride's gold/mustard family.** Inspect the codebase for the actual brand tokens first and treat them as the source of truth. Refine usage and derive harmonious supporting shades. Do not replace the palette with generic purple/blue AI gradients.

Illustrative starting points only (defer to repo tokens):

- Signature gold `#C9A13D`
- Soft champagne `#E6D3A1`
- Pale warm ivory `#F6F3ED`
- Deep charcoal `#191A1C`
- Midnight navy `#141C27`
- Muted stone `#74746C`
- Soft sage `#BBC7B8`
- Restrained periwinkle `#969DC6`

Gold is the anchor. Secondary colors get specific functional roles (for example: confidence states, metric categories, recovery). Subtle gradients between gold, champagne, smoky navy, lavender-gray, and neutrals are welcome where they serve composition. No neon, exaggerated glow, muddy gradients, or competing accents.

Check gold against light backgrounds for WCAG AA. Gold text on ivory will likely fail; derive a darker gold for text and keep the bright gold for fills and large elements.

### Light mode

Warm, polished, editorial. Ivory, porcelain, soft mineral surfaces, charcoal, gold. Material depth without heavy shadows. Use tonal sections and occasional darker immersive modules (for example the analysis viewer) rather than one flat off-white everywhere.

### Dark mode

Intentionally art-directed, not inverted. Deep charcoal and midnight surfaces with subtle plum/navy undertones, gold and champagne highlights, selective atmospheric light, fine borders, controlled elevation, carefully calibrated charts. It should feel like an elite performance instrument.

Both modes are one system built on semantic tokens. No hardcoded per-screen colors.

---

## 5. Known Problems in the Current UI (replace, do not patch)

From the current build:

- Upload screen: huge empty vertical space, oversized display type, a basic gold button as the main affordance, and no visual emphasis on the athlete or camera.
- Progress, Plan, and Coach are all mostly empty for a new user, each with its own generic empty message, and nothing connects them to the first recording.
- Coach is a generic chatbot: five static prompt chips and an input field, with no link to the athlete's data.
- Plan is a bare month calendar with a "Rest Day" label.
- Settings is a sparse stack of large rounded containers.
- Headings everywhere use maximum-weight display type regardless of importance.

Also remove, wherever unjustified: identical rounded-card grids, arbitrary gradients, excessive shadows, decorative icons or emoji, monotonous type sizing, borders around every container, oversized padding, identical empty states, unstructured metric dumps, decorative-only animation.

Do not overcorrect by removing all cards, radius, whitespace, or familiar navigation. The goal is intentional design.

---

## 6. Build the Design System First

Before rebuilding screens, create the new system. This is where the references get unified into one Stride language.

Include:

- Semantic light and dark color tokens.
- Typography scale and font roles (display, editorial, UI, numeric/tabular, caption). Large type only where it creates deliberate editorial impact.
- Spacing and layout scales, including at least two density modes (editorial and instrument).
- Corner-radius rules.
- Surface and material treatments (flat, tonal, immersive/dark, lit/sculptural).
- Borders and elevation.
- Buttons and control states.
- Navigation components (tab bar, headers, sheets).
- Chart styling (lines, fills, scrubbers, axes, confidence bands).
- Video overlay styling (keypoints, limbs, trajectories, angle arcs, labels).
- Motion primitives (durations, springs, easing per interaction class).
- Iconography.
- Accessibility states.

For each token group, note which reference properties it encodes.

Consistency comes from this shared language, not from repeating identical layouts. Screens should differ in composition and density.

Once the system exists, the old component library is deprecated. Delete superseded components and styles as screens migrate.

---

## 7. Screen-by-Screen Redesign

### Inventory first

Inventory the entire app before implementing anything: every route, nested screen, modal, bottom sheet, onboarding step, analysis state, settings page, loading/empty/error state, and reusable component. Do not limit yourself to the five tabs.

### Required reasoning for each screen

1. Examine the current implementation and screenshot.
2. State the screen's primary user intent.
3. Name its three biggest visual or UX problems.
4. Name the reference properties it will integrate (from Section 3).
5. Sketch at least two genuinely different layout directions (different structure, not different colors).
6. Choose one and explain why.
7. Implement it from the new design system.
8. Screenshot it and review against the references (Section 9).
9. Iterate until it meets the standard.

Record this in a screen-by-screen design matrix.

### Priority areas

**A. Capture and recording.** Video-first. The live camera or preview is the composition. Elegant record controls, subtle framing guides for side-on positioning at 10 to 20 m, frame-rate indicator, 12-second limit made visible, clear record vs. import choice, and a processing transition that carries visually into results. Recording requirements must stay accurate.

**B. Analysis results: the signature screen.** Make the athlete's movement the centerpiece. Video with real keypoint overlays, scrubbable running cycle, joint/limb selection, temporal angle curves synced to the video, motion trails from real tracked points, session-to-session comparison, a clear summary first and depth on demand, evidence-backed AI explanations, visible confidence per metric (including withheld metrics), and direct links from each observation to corrective exercises. Never present the 11 metrics as a uniform grid of cards.

**C. Progress and insights.** A designed first-analysis experience for new users, not a void with a sentence. For returning users, the most important changes are visible immediately. Interactive trajectories, comparisons, distinct metric categories, video thumbnails, meaningful improvement indicators, expandable scientific detail.

**D. AI Coach.** A contextual coaching home, not a chatbot. Priorities and recommendations tied to actual analysis outputs, exercise demonstrations, personalized technique explanations, training and recovery guidance, with chat integrated as a layer. Clearly distinguish data-grounded observations from general advice. When no user data exists, say so honestly and guide to the first recording. Keep existing assistant functionality.

**E. Training plan.** Today's session as the focal point, a weekly timeline, session detail views, phase progress, clear distinctions between sprint, strength, mobility, and recovery work, exercise media, completion interactions, periodization views only when the data supports them, the monthly calendar as a secondary view, and a considered rest-day state.

**F. Settings, profile, account.** Compact, quiet, native-feeling. Account presentation, profile and preferences, appearance (light/dark/system), accessibility, privacy, and properly confirmed sign-out and delete-account flows.

**G. Everything else.** Authentication, onboarding, athlete profile setup, every drill and exercise page, video preview and playback, processing and loading, progress details, empty states, errors, modals, sheets, confirmations, and any other route in the repo. Nothing keeps the legacy UI.

---

## 8. Motion and Interaction

Build a coherent motion language with different characters per interaction class:

- **Navigation and controls:** fast, restrained, spring-based.
- **Data interaction:** responsive chart scrubbing, synced video/graph indicators, fluid expand/collapse.
- **Signature moments:** cinematic transitions reserved for capture-to-analysis, analysis completion, and biomechanics exploration (draw on Loóna and Opal).
- Shared-element transitions where they clarify continuity.
- Haptics where supported.

No constant ambient animation, no decorative motion, nothing that degrades responsiveness. Honor reduced-motion settings.

---

## 9. Implementation and Quality Bar

### Implementation

- Inspect the actual architecture, framework, UI libraries, and dependencies first. Work within the existing stack (React Native). Justify any significant new dependency.
- Preserve business logic, API integrations, auth, video processing, persistence, and user data.
- Do not invent backend capabilities to get better visuals. Where data is unavailable, design an honest state.
- Complete light and dark themes, theme switching on every screen, system appearance support.
- WCAG AA text contrast, Dynamic Type/font scaling where feasible, safe areas, keyboard handling, no clipping, overlap, or horizontal overflow across supported phone sizes.
- Handle loading, empty, failure, and populated states everywhere.

### Visual QA

Run the app and screenshot **every screen in both themes**, including empty and populated states where test data exists.

For each screen, do a **reference fidelity review**: place the Stride screenshot beside its mapped reference screens and answer:

1. Would this screen sit credibly in the same Refero collection as its references?
2. Which specific reference properties are visible in it?
3. Is it still unmistakably Stride?
4. Does it still resemble generic AI-generated UI or the old Stride layout anywhere?

Also review composition, color harmony, type, spacing, contrast, interaction quality, differentiation between screens, and navigation coherence. After the first full pass, rebuild the weakest screens.

Run the project's lint, type-check, and build, and test critical flows (auth, recording, import, analysis, plan, coach).

---

## 10. Deliverables

1. Audit of the existing UI and navigation, including the full screen inventory.
2. Reference research notes with concrete properties per product, plus any access limitations.
3. The final reference-to-screen integration matrix.
4. The documented Stride design system.
5. The full redesign implemented in the codebase, with legacy UI components removed.
6. Complete light and dark themes.
7. Before/after screenshot pairs for every screen, in both themes.
8. Side-by-side reference fidelity screenshots for key screens.
9. Summary of major UX and architecture changes with rationale.
10. Validation results (lint, types, build, flow tests) and remaining issues.

Do not stop at mockups, plans, or recommendations. **Implement the redesign in the codebase.**

---

## Final Standard

Stride should not look like a workout tracker with a chatbot attached, and it should not look like the current Stride with new styling. It should look like a new category of product: **a premium, beautifully engineered biomechanics laboratory and coaching staff in an athlete's pocket**, built with the same level of craft as Opal, Lumy, Endel, Loóna, Imprint, Flighty, and Cosmos, and unmistakably Stride in its gold, warm, athletic identity.

**Begin with repository inspection and reference research. Then build the design system, rebuild every screen, and validate.** redesign the entire UI (using https://refero.design/ios-apps)
  /Users/adhibanarulselvan/Desktop/StrideFinal/Stride-v1/.maestro/UIredesign.md We need to ensure
  that there is a clean UI redesign (that still keeps the functionality of the app) because the
  previous redesigns arent actually complete and they are very very bad.