-- Output of the pilot run of the offline biomechanics research pipeline
-- (apps/api/scripts/research/generate-metric-biomechanics.ts), run manually
-- for `pelvic_drop` on 2026-08-25 as the dry run specified in
-- docs/research/metric-biomechanics.md before scaling to the other 10
-- metrics. Went through biometrics-agent research + 2 independent checkers
-- (checker A: confirmed, one correction; checker B: partial, one addition —
-- see pipeline_run_id note below).
--
-- reviewed_by / reviewed_at are intentionally NULL. Per the pipeline's own
-- design, agent-checker verification is NOT the same gate as human sign-off
-- on health-adjacent content — this row must not be synced into
-- biomech2d.py's WHY dict, coach/knowledge.ts, or
-- reference_drills.recovery_phases until a human explicitly reviews it and
-- sets reviewed_by.
--
-- (reference_drills.sql's drill-hip-hitch.recovery_phases WAS populated from
-- this same pilot output as a demonstration of the target shape — that is a
-- seed-data convenience for local dev, not evidence this row was reviewed.
-- Treat both as pending review together.)
INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'pelvic_drop',
'lateral hip / pelvis (frontal plane)',
'Gluteus medius/minimus and TFL (hip abductor group) — the standard hypothesis via a Trendelenburg-style mechanism, though contested (see hedge_note)',
'During single-leg stance, the stance-side hip abductors must contract to hold the pelvis level against the swing leg''s weight; when they under-perform, the contralateral hip drops below horizontal. A dropped pelvis pulls the stance-leg femur into relative adduction/internal rotation, increasing frontal-plane loading on the hip and knee. One dissertation found no correlation between glute medius strength/activation/fatigue and pelvic-drop magnitude in runners, which points toward a motor-control/timing deficit as a plausible co-driver rather than pure force capacity.',
'[
  {"name": "Medial tibial stress syndrome (MTSS / shin splints)", "mechanism_note": "Strongest evidence: a prospective (pre-injury baseline) study found runners who later developed MTSS had greater baseline pelvic drop, and an RCT found hip-abductor training reduced both pelvic drop and MTSS symptoms."},
  {"name": "General pooled running-injury risk (PFP, ITBS, MTSS, Achilles tendinopathy combined)", "mechanism_note": "A cross-sectional study (n=108) found each 1° increase in pelvic drop associated with ~80% higher odds of injured-vs-healthy status, but the design cannot establish causation direction or attribute the signal to a specific diagnosis."},
  {"name": "Patellofemoral pain syndrome (PFPS)", "mechanism_note": "Sex-conditional: pelvic drop specifically predicts PFPS in male runners; in female runners, hip adduction/internal rotation is the more specific predictor."},
  {"name": "Iliotibial band syndrome (ITBS)", "mechanism_note": "Weakest link despite being the most commonly assumed one — a systematic review of 3 cross-sectional studies found NO significant difference in peak pelvic drop, hip adduction, or hip abductor moment between ITBS and healthy runners. The actual predictors identified were peak knee internal rotation and peak trunk ipsilateral flexion."},
  {"name": "Gluteal tendinopathy / greater trochanteric pain syndrome (GTPS)", "mechanism_note": "Biomechanically plausible (increased hip adduction/pelvic shift raises compressive tendon load) but no dedicated pelvic-drop-specific study was found by the research or either checker pass."},
  {"name": "Hamstring strain (sprint-specific)", "mechanism_note": "Weakest/most speculative: a single small study reportedly found increased mediolateral pelvic asymmetry in previously-injured sprinters, but neither the researching agent nor either checker could access the primary source (persistent 403) to confirm effect sizes."}
]',
'emerging',
'correlational',
'The base mechanism (weak hip abductors -> pelvic drop, i.e. Trendelenburg) is textbook-established, but is itself contested for RUNNERS specifically by at least one dissertation finding no strength/activation correlation. The downstream link from pelvic-drop magnitude to injury is genuinely mixed and injury-specific, not a single settled story: strong prospective support for MTSS, cross-sectional pooled-injury support with unclear attribution (Bramah 2018), sex-conditional support for PFPS, and an explicit NULL result for ITBS despite ITBS being the most commonly assumed association in coaching material. Two independent checker passes both converged on "emerging/contested" as the right confidence label rather than "established". Treat as a coaching risk flag worth attention, especially for MTSS-relevant presentations — not as a diagnostic claim, and do not lead with ITBS as the injury this metric predicts.',
'[
  {"citation": "Becker J, Nakajima M, Wu WFW. Factors Contributing to Medial Tibial Stress Syndrome in Runners: A Prospective Study. Med Sci Sports Exerc. 2018", "url_or_doi": "PMID 29787473", "what_it_shows": "Prospective, pre-injury baseline: runners who later developed MTSS had significantly greater baseline contralateral pelvic drop, tighter ITB, weaker hip abductors, more rearfoot eversion."},
  {"citation": "Lashien SA, Abdelnaeem AO, Gomaa EF. Effect of hip abductors training on pelvic drop and knee valgus in runners with medial tibial stress syndrome: a randomized controlled trial. J Orthop Surg Res. 2024;19:700", "url_or_doi": "PMID 39468623, DOI 10.1186/s13018-024-05139-3", "what_it_shows": "RCT, n=40: 8 weeks of hip-abductor training reduced pelvic drop 6.86 deg to 3.44 deg (p<0.001) alongside MTSS symptom improvement. Both checkers independently pulled the full text and confirmed these exact numbers."},
  {"citation": "Aderem J, Louw QA. Biomechanical risk factors associated with iliotibial band syndrome in runners: a systematic review. BMC Musculoskelet Disord. 2015", "url_or_doi": "PMID 26573859, DOI 10.1186/s12891-015-0808-7", "what_it_shows": "Meta-analysis of 3 cross-sectional studies: no significant difference in peak pelvic drop, hip adduction, OR hip abductor moment between ITBS and healthy runners. Significant predictors were peak knee internal rotation and peak trunk ipsilateral flexion only. NOTE: the original research pass mischaracterized hip adduction as a consistent predictor per this paper — Checker A caught this; hip adduction was also non-significant here."},
  {"citation": "Venable EN, Seynaeve LA, Beale ST, et al. Relationships between Running Biomechanics, Hip Muscle Strength, and Running-Related Injury in Female Collegiate Cross-country Runners. Int J Sports Phys Ther. 2022;17(6):1053-1062", "url_or_doi": "PMC9528670, DOI 10.26603/001c.38017", "what_it_shows": "Prospective, n=20: no significant association between pelvic drop and injury generally — explicitly contradicts Becker 2018 in the paper''s own discussion."},
  {"citation": "Burnet EN. Frontal Plane Pelvic Drop in Runners: Causes and Clinical Implication (doctoral dissertation). Virginia Commonwealth University", "url_or_doi": "scholarscompass.vcu.edu/etd/1212", "what_it_shows": "No correlation found between glute medius strength/EMG activation/fatigue and pelvic drop magnitude; also found no effect of pelvic-drop change on running-economy change. Single dissertation, not peer-reviewed journal — treat as preliminary."},
  {"citation": "Bramah C, Preece SJ, Gill N, Herrington L. A 2D and 3D Comparison of Static and Dynamic Postural Alignment Measures in Runners With and Without a History of Injury. Am J Sports Med. 2018", "url_or_doi": "PMID 30193080", "what_it_shows": "Cross-sectional, n=108 (72 injured/36 healthy, pooled across PFP/ITBS/MTSS/Achilles): each 1 deg increase in contralateral pelvic drop associated with ~80% higher odds of injured-vs-healthy status. Retrospective; authors state causal direction cannot be determined. Missed by the initial research pass — added by Checker B."},
  {"citation": "Trendelenburg Gait. StatPearls, NCBI Bookshelf (NIH)", "url_or_doi": "https://www.ncbi.nlm.nih.gov/books/NBK541094/", "what_it_shows": "Clinical reference for the core mechanism: hip abductor insufficiency causes contralateral pelvic drop during single-leg stance."},
  {"citation": "Nurse CA et al. Physical Therapy in Sport, 2023 (exact title/authors not independently confirmed — primary source blocked, 403, for the researching agent and both checkers)", "url_or_doi": "https://www.sciencedirect.com/science/article/abs/pii/S1466853X23001281 (inaccessible)", "what_it_shows": "Secondary sources indicate a positive finding (mediolateral pelvic asymmetry in previously-injured sprinters) but this was never confirmed against primary text by anyone in the pipeline — flagged low-confidence."}
]',
'confirmed',
'partial',
NULL,
NULL,
'pilot-2026-08-25-pelvic-drop'
);

-- ─── Full-batch pipeline run (remaining 10 metrics) ──────────────────────
-- Same review-gate discipline as the pelvic_drop pilot above: reviewed_by/
-- reviewed_at are NULL on every row. Checker-corrected content (citation
-- fixes, confidence downgrades, corrected framing) is already reflected here
-- — see docs/research/metric-biomechanics.md for the full pipeline write-up.

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'trunk_lean',
'trunk / lumbopelvic-hip complex',
'Lumbar spine and thoracic posture, mediated by hip extensor (glute/hamstring) vs knee extensor (quad) load-sharing',
'Trunk angle sets the ground-reaction-force moment arm at the hip: a more upright trunk shifts load toward the knee extensors (associated with overstriding and higher patellofemoral joint stress); a moderately forward-leaned trunk increases hip-extensor recruitment and lowers patellofemoral stress. This is a well-replicated relationship (Teng & Powers 2014; AminiAghdam et al. 2022; a 2025 meta-analysis), not a single-study result. But the relationship is NOT one-directional — large forward-lean increases beyond a moderate range (Warrener, Tamai & Lieberman 2021) raised loading rate 29% and GRF impact transients 20%, and were associated with knee pain, medial tibial stress syndrome, AND back pain. The healthy band is explicitly phase-dependent: 35-55 deg during acceleration reflects the intentional forward-projected start posture; 8-22 deg is normal for upright running.',
'[{"name":"Patellofemoral pain syndrome (from excess upright posture)","mechanism_note":"An overly upright trunk raises knee-extensor moment and patellofemoral joint stress; well-replicated across 3+ independent kinetic-modeling studies."},{"name":"Medial tibial stress syndrome / knee pain / low back pain (from excessive forward lean)","mechanism_note":"Large forward-lean increases (+10 to +30 deg beyond baseline) raised loading rate and GRF impact transients in a controlled study, with these three conditions all reported at the largest lean increases — a real, opposite-direction risk from the same metric."},{"name":"Hamstring strain injury","mechanism_note":"Weakest link: only 2 studies exist (a single case study and an 8-injury video analysis), both explicitly described by their own authors as speculative-to-weak evidence for a trunk-lean-to-hamstring-strain association."},{"name":"Low back pain (general, correlational)","mechanism_note":"Cross-sectional studies find altered sagittal trunk kinematics in runners with existing LBP, but this does not establish trunk lean during running as a cause rather than a consequence."}]',
'emerging',
'biomechanically_plausible',
'The PFJ-stress mechanism for excess upright posture is cross-validated by 3+ independent studies plus a meta-analysis — stronger than "emerging" for that specific sub-claim. The opposite-direction injury profile (large forward lean -> loading rate/impact/back pain) rests on one controlled study (Warrener 2021) but is real and should not be dropped. Hamstring and general LBP links are genuinely weak. The running-economy claim (Warne et al. 2024, ~8% cost increase) only tested lean up to 8.4 deg, near the low end of the normal band — do not frame this as "excessive lean," it describes drifting to the edge of normal, not overshooting into pathological territory.',
'[{"citation":"Teng HL, Powers CM. Sagittal Plane Trunk Posture Influences Patellofemoral Joint Stress During Running. J Orthop Sports Phys Ther. 2014;44(10):785-792","url_or_doi":"PMID 25155651","what_it_shows":"Flexed trunk posture (14.1 deg) had lower peak PFJ stress (20.2 MPa) than extended posture (4.0 deg, 23.1 MPa)."},{"citation":"AminiAghdam S, Epro G, James D, Karamanidis K. Leaning the Trunk Forward Decreases Patellofemoral Joint Loading During Uneven Running. J Strength Cond Res. 2022","url_or_doi":"PMID 34537800","what_it_shows":"Corroborates the PFJ-stress finding on uneven running surfaces. NOTE: originally miscited as \"Warrener et al.\" — corrected here."},{"citation":"Warrener A, Tamai R, Lieberman DE. The effect of trunk flexion angle on lower limb mechanics during running. Hum Mov Sci. 2021;78:102817","url_or_doi":"ScienceDirect S0167945721000658","what_it_shows":"Large forward-lean increases (+10 to +30 deg) raised loading rate +29%, GRF impact transients +20%, overstride +28%; associated with knee pain, MTSS, and back pain."},{"citation":"Warne JP, et al. The effect of forward postural lean on running economy, kinematics, and muscle activation. PLOS ONE. 2024","url_or_doi":"PMC11135760","what_it_shows":"16 runners: maximal lean (8.4 deg) raised metabolic cost ~8% vs self-selected posture (1.7 deg); this is at the LOW end of the normal upright band, not \"excessive\" lean."},{"citation":"Kalema RN, et al. Sprinting Biomechanics and Hamstring Injuries: Is There a Link? A Literature Review. Sports (Basel). 2021;9(10):141","url_or_doi":"PMC8540816","what_it_shows":"Only 2 studies link trunk lean to hamstring strain; both self-described as weak/speculative evidence."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'knee_drive',
'hip (anterior) / thigh',
'Hip flexors — iliopsoas and rectus femoris',
'Peak thigh-vs-vertical angle during swing is a task-level proxy for hip-flexor power/rate of force development, not a true joint-angle diagnostic. Nagahara & Murata (2020) tie hip-flexion power specifically to STEP FREQUENCY (a citation correction — this was originally miscited for stride length). IMPORTANT: the classic "more knee drive is always better" coaching narrative is now genuinely contested — Haralabidis et al. 2022 (Nature Scientific Reports, predictive simulation) found the best-performing simulated sprint techniques actually had LOWER hip extension at takeoff, with knee-moment changes driving more performance gain than thigh-angle/front-side technique; this is independently corroborated by Haugen et al. 2018, an empirical study finding front-side mechanics were not crucial to sprint performance.',
'[{"name":"Hamstring strain (via poor front-side/backside mechanics)","mechanism_note":"Modeling-based only (Chumanov et al. lineage) — no direct prospective epidemiological link established."},{"name":"Hip flexor strain (iliopsoas/rectus femoris)","mechanism_note":"General loading-pattern risk from explosive hip flexion in sprinting; not specifically scaled to knee-drive magnitude."}]',
'preliminary',
'correlational',
'Confidence downgraded from "emerging" per checker findings: the front-side-mechanics-drives-performance narrative is actively contested by at least 2 independent studies (one empirical, one predictive-simulation), not just sparse early data. Treat as "mechanistically plausible but empirically contested." Hip-flexor power/step-frequency is the best-supported piece; do not chase thigh angle directly as a training target.',
'[{"citation":"Nagahara R, Murata M. Inertial Measurement Unit Based Hip Flexion Strength-Power Test for Sprinters. Front Sports Act Living. 2020","url_or_doi":"PMC7739800","what_it_shows":"Hip-flexion positive work/power correlated with sprint speed AND step frequency specifically (r=0.501-0.688), not stride length."},{"citation":"Haralabidis N, et al. Modifications to the net knee moments lead to the greatest improvements in accelerative sprinting performance: a predictive simulation study. Sci Rep. 2022;12:15908","url_or_doi":"nature.com/articles/s41598-022-20023-y","what_it_shows":"Best-performing simulated techniques abandoned classic front-side kinematics (LOWER hip extension at takeoff, -1 to -4 deg); knee-moment changes drove the largest gains (13.8%, 21.9%). Corroborates Haugen 2018."},{"citation":"Haugen T, et al. On the Importance of Front-Side Mechanics in Athletics Sprinting. Int J Sports Physiol Perform. 2018;13(4):420-427","url_or_doi":"journals.humankinetics.com","what_it_shows":"Empirical 3D motion-capture study (24 sprinters): \"did not support that front-side mechanics were crucial for sprint performance\" — ground-force/impulse mattered more than thigh kinematics."},{"citation":"Miyashiro K, et al. Kinematics of Maximal Speed Sprinting. Front Sports Act Living. 2019","url_or_doi":"PMC7739839","what_it_shows":"Correlational: greater thigh angle at contralateral foot strike associated with faster speed (adj R^2=0.194-0.378), cross-sectional."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'hip_extension',
'hip / posterior thigh (proxy: trunk-thigh sagittal angle)',
'Hip extensors (glutes, hamstrings) as prime movers; hip flexor-tendon unit (iliopsoas, rectus femoris) as the range-limiting antagonist',
'Stride measures a shoulder-hip-knee TRUNK-THIGH proxy angle at toe-off, NOT true anatomical hip extension in a pelvis-referenced frame — none of the cited studies measure this exact composite angle, only conventional pelvis-referenced hip kinematics; this gap should be stated plainly, not softened. Hip extensors drive extension near toe-off; range is bounded by hip flexor extensibility. Hamstrings reach peak musculotendon stretch in late swing near/after toe-off (Chumanov 2007, confirmed timing-only, no injury-causation claim).',
'[{"name":"Hamstring strain injury","mechanism_note":"A 2021 systematic review found NO experimental study has directly tested a toe-off-extension-to-HSI causal link (Kalema et al. — more precisely a \"literature review with risk-of-bias appraisal,\" not a formal systematic review). However, MORE DIRECT prospective evidence exists via a different pathway: Schuermans et al. and Kenneally-Dabrowski et al. found anterior pelvic tilt + thoracic side-bend during swing, and greater hip-extensor moment/knee power in late swing, prospectively predicted hamstring strain — stronger evidence than pure toe-off timing reasoning."},{"name":"Hip flexor/iliopsoas or rectus femoris strain","mechanism_note":"Clinical-reasoning level only, no controlled study of this specific metric."},{"name":"Low back pain (via hip-flexor tightness -> anterior pelvic tilt)","mechanism_note":"A separate, real pathway: hip flexor tightness (positive Thomas test) is associated with ~22% incidence of low back pain in runners in at least one review — distinct from the hamstring-timing pathway above."}]',
'preliminary',
'biomechanically_plausible',
'The trunk-thigh proxy vs true anatomical hip extension gap is real and literature-grounded, not a technicality — emphasize it, not soften it. Two distinct injury pathways exist (pelvis-control/hamstring-timing via Schuermans/Kenneally-Dabrowski; hip-flexor-tightness/APT/LBP) and should not be conflated into one story. The Morin et al. 2015 paper does NOT use the term "triple extension" as sometimes cited — its actual finding is hamstring pre-activation timing before contact, and it found NO significant relationship between stance-phase hip-extensor activity and horizontal force; cite it precisely.',
'[{"citation":"Kalema RN, et al. Sprinting Biomechanics and Hamstring Injuries: Is There a Link? A Literature Review. Sports (Basel). 2021;9(10):141","url_or_doi":"PMC8540816","what_it_shows":"No experimental study directly tests toe-off-extension-to-HSI; authors explicitly avoided formal systematic-review methodology due to low evidence quality."},{"citation":"Chumanov ES, Heiderscheit BC, Thelen DG. The effect of speed and influence of individual muscles on hamstring mechanics during swing. J Biomech. 2007;40(16):3555-3562","url_or_doi":"PMID 20689454-adjacent","what_it_shows":"Biceps femoris musculotendon length peaks in late swing near/after toe-off — timing only, no injury-causation claim."},{"citation":"Morin JB, Gimenez P, Edouard P, et al. Sprint Acceleration Mechanics: The Major Role of Hamstrings in Horizontal Force Production. Front Physiol. 2015;6:404","url_or_doi":"PMC4689850","what_it_shows":"Real finding is hamstring PRE-ACTIVATION EMG timing before contact; found NO significant relationship between stance-phase hip-extensor activity and horizontal force. Does NOT use \"triple extension\" terminology — cite precisely."},{"citation":"Schuermans J, Van Tiggelen D, Danneels L, Witvrouw E. Proximal Neuromuscular Control Protects Against Hamstring Injuries. Am J Sports Med. 2017","url_or_doi":"referenced via secondary review","what_it_shows":"Prospective: anterior pelvic tilt + thoracic side-bend during swing predicted later hamstring strain — a pelvis-control mechanism, not pure timing."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'overstride',
'lower extremity (knee/patellofemoral joint primary; tibia and hamstring secondary)',
'Patellofemoral joint (quadriceps/patellar-tendon-mediated knee-extensor loading)',
'Foot landing ahead of the center of mass produces a backward-pointing GRF and braking impulse; knee extensors absorb more energy to decelerate. This part is CAUSALLY demonstrated, not just correlated: Heiderscheit et al. 2011, a within-subject cadence-manipulation trial, found +5-10% cadence cut knee mechanical energy absorption 20-34% and reduced braking impulse, hip adduction, and hip/knee flexion angles.',
'[{"name":"Patellofemoral pain syndrome","mechanism_note":"Cross-sectional case-control (CART analysis, n=38 vs 38): higher braking GRF impulse and loading rate distinguish PFP runners. Correlational, authors state prospective study is needed."},{"name":"Tibial bone stress injury","mechanism_note":"Indirect — a foot-strike-angle modeling study (not overstride distance directly) shows landing mechanics alter tibial bending moment. Plausible via loading-rate proxies, not directly tested for overstride distance."},{"name":"Hamstring strain","mechanism_note":"Small retrospective study (n=35 injured vs 35 matched controls): 4.9 deg greater overstride angle in injured runners (p=0.001, d=0.98) — large effect but directionality unresolved (video taken after injury already occurred)."}]',
'emerging',
'biomechanically_plausible',
'Broader meta-analyses of prospective injury-risk-factor studies find no meaningful biomechanical differences between injured and non-injured runners generally — reinforcing that despite overstriding being one of the most repeated coaching claims in running, direct injury-outcome-level causal evidence remains genuinely thin. The cadence-manipulation mechanism (Heiderscheit 2011) is solid and causal; the leap from "more loading" to "more injury" rests on small retrospective/cross-sectional studies only. Frame corrective work as efficiency/loading correction, not injury prevention.',
'[{"citation":"Heiderscheit BC, Chumanov ES, Michalski MP, Wille CM, Ryan MB. Effects of step rate manipulation on joint mechanics during running. Med Sci Sports Exerc. 2011;43(2):296-302","url_or_doi":"PMC3022995","what_it_shows":"Within-subject cadence manipulation: +5%/+10% cadence caused 20%/34% decrease in knee energy absorption, decreased braking impulse and peak knee flexion — causal."},{"citation":"Interaction of Biomechanical, Anthropometric, and Demographic Factors Associated with Patellofemoral Pain: A CART Approach. Sports Med Open. 2023","url_or_doi":"PMC10774254","what_it_shows":"Case-control (38 v 38): braking GRF impulse and loading rate top discriminators of PFP status. Correlational."},{"citation":"Running Propensities of Athletes with Hamstring Injuries. Sports (MDPI). 2019;7(9):210","url_or_doi":"PMC6784223","what_it_shows":"4.9 deg greater overstride angle in injured (n=35) vs matched controls (p=0.001, d=0.98); retrospective, directionality unresolved."},{"citation":"Association Between Temporal Spatial Parameters and Overuse Injury History in Runners: Systematic Review and Meta-analysis. Sports Med. 2019","url_or_doi":"Springer","what_it_shows":"13 studies: no difference in stride length between injured and healthy runners (mean diff 0.00m); null result for the related stride-length metric."}]',
'confirmed',
'confirmed',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'vertical_oscillation',
'whole-body vertical plane (COM/pelvis trajectory)',
'No single structure — a global kinematic outcome of leg/hip stiffness regulation during stance',
'Reflects how much the center of mass rises and falls each stride as the stance leg absorbs and redirects ground reaction force; stiffer, more elastic leg/hip springs redirect more force horizontally and bounce less. This is PRIMARILY a running-economy/performance metric, not an injury metric. Lower VO correlates with better running economy (r=0.35, moderate) per a real meta-analysis (Van Hooren et al. 2024, Sports Medicine — corrected citation, this was originally miscited as ''Bramah et al.'').',
'[{"name":"Bone stress injury (weak, single study)","mechanism_note":"ONE prospective cohort (Joachim, Kliethermes, Heiderscheit 2023, JOSPT, n=103 collegiate cross-country runners) found greater vertical COM displacement associated with bone stress injury risk (RR=1.14 per 0.5cm, 95% CI 1.01-1.29, p=.04) — a borderline effect with a CI barely excluding 1.0, not replicated elsewhere."}]',
'preliminary',
'correlational',
'Stride''s own code already flags this as a CANDIDATE metric, never headline-trusted, unmeasured on runners in its own honesty ledger — this new research confirms that caution is well-founded generally, not just for Stride''s specific implementation. Frame this entire training program as a PERFORMANCE/ECONOMY intervention, not injury remediation — the one injury study is weak, borderline-significant, single-cohort evidence. Do not conflate vertical oscillation with vertical loading rate/impact peak, a related but distinct, more-studied metric.',
'[{"citation":"Van Hooren B, Jukic I, Cox M, Frenken KG, Bautista I, Moore IS. The Relationship Between Running Biomechanics and Running Economy: A Systematic Review and Meta-Analysis. Sports Med. 2024;54(5):1269-1316","url_or_doi":"PMC11127892","what_it_shows":"51 studies, n=1115: r=0.35 (95% CI 0.19-0.49) between vertical oscillation and oxygen cost. Correctly attributed here after checker correction (was miscited as \"Bramah et al.\")."},{"citation":"Joachim MR, Kliethermes SA, Heiderscheit BC. Preseason Vertical Center of Mass Displacement and Bone Mineral Density Z-Score Are Risk Factors for Bone Stress Injury in Collegiate Cross-country Runners. J Orthop Sports Phys Ther. 2023;53(12):761-768","url_or_doi":"PMID 37860857","what_it_shows":"Prospective, n=103: RR=1.14 per 0.5cm VO increase (95% CI 1.01-1.29, p=.04) — borderline, single study."},{"citation":"Validity and reliability of wearable devices for measurement of vertical oscillation. PLOS ONE. 2022","url_or_doi":"PMC9671438","what_it_shows":"Devices reliable but systematically over/under-estimate absolute VO relative to each other and video — supports caution about single-clip VO estimates."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'contact_time_ms',
'lower leg / ankle-foot complex',
'Achilles tendon and triceps surae — the elastic leg-spring',
'Shorter, stiffer ground contact reflects a more reactive leg-spring, correlating with reactive strength index (RSI) and faster sprinting. IMPORTANT PHASE-DEPENDENT NUANCE: Stride''s 80-140ms band fits max-velocity elite sprinting well (elite ~105-120ms), but elite ACCELERATION-PHASE contact times legitimately run ~150-165ms — above the app''s own 140ms ceiling. Do not cue "shorter is always better" during acceleration-phase work.',
'[{"name":"Achilles tendinopathy (short contact time, high speed)","mechanism_note":"Starbuck et al. 2021 (endurance runners): shorter GCT at higher speed raised Achilles loading rate +57.3%. Corroborated by one additional independent paper. Correlational, endurance runners not sprinters."},{"name":"Bone stress injury (weak/indirect)","mechanism_note":"A citation correction applies here: the paper warning that external GRF/loading-rate metrics poorly predict internal tibial bone load is Matijevich et al. 2019, PLOS ONE (PMC6336327) — not the paper originally cited."},{"name":"Hip/hamstring load shift (long contact time, overstriding-related)","mechanism_note":"Performance-limiting more than a proven injury mechanism — no dedicated study directly ties long contact time to hamstring injury, only general overstriding/braking-impulse reasoning."}]',
'emerging',
'correlational',
'Target contact time is genuinely phase-dependent: ~80-140ms is the correct target for max-velocity phase; ~150-165ms is normal and correct for acceleration-phase strides. A training plan that indiscriminately pushes shorter contact time during acceleration work is training against normal, correct mechanics for that phase.',
'[{"citation":"Starbuck C, Bramah C, Herrington L, Jones R. The effect of speed on Achilles tendon forces and patellofemoral joint stresses in high-performing endurance runners. Scand J Med Sci Sports. 2021;31(8):1657-1665","url_or_doi":"PMID 33864288","what_it_shows":"20 endurance runners: +19.5% peak Achilles force, +57.3% loading rate with increased speed/shorter contact time."},{"citation":"Matijevich ES, et al. Ground reaction force metrics are not strongly correlated with tibial bone load when running across speeds and slopes. PLOS ONE. 2019","url_or_doi":"PMC6336327","what_it_shows":"GRF impact peak and loading rate correlate only weakly/negatively with modeled tibial bone load (r=-0.29 to -0.20) — external metrics are a poor proxy for internal bone loading. Corrected citation (was originally miscited)."},{"citation":"Blauberger P, et al. Detection of Ground Contact Times with Inertial Sensors in Elite 100-m Sprints. Sensors. 2021","url_or_doi":"PMC8587724","what_it_shows":"5 elite sprinters, 34 sprints: max-velocity phase GCT 104.8-118.4ms; ACCELERATION phase (first 5 steps) averaged 163.45+/-24.73ms — well above Stride''s 140ms ceiling, confirming the phase-dependent miscalibration."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'cadence_spm',
'posterior thigh / hip-knee complex (secondary: hip flexor-extensor, lower-leg)',
'Hamstrings (biceps femoris long head), via late-swing eccentric loading',
'Low step frequency relative to speed is the kinematic signature of overstriding, which increases late-swing eccentric hamstring loading. This LATE-SWING HAMSTRING LOADING MECHANISM ITSELF is sprint-native and well-established (Chumanov, Schache, Heiderscheit, Thelen lineage). But the specific claim that CADENCE is the causal lever driving injury risk is weaker: the one direct sprint-population study (18 Polish national sprinters) found NO significant link between step-pattern variability and injury history (null result, not just absence of data).',
'[{"name":"Hamstring strain (late-swing eccentric loading — well-established mechanism)","mechanism_note":"The mechanism itself is sprint-native and solid; whether LOW CADENCE specifically drives it (vs. general sprint mechanics) is the weaker, extrapolated part."},{"name":"Tibial stress injury (weak, population-mismatch)","mechanism_note":"Evidence entirely from distance runners at 150-180 spm (Luedke et al., ~6-7x risk ratio) — zero sprint-population (270-330 spm) tibial-injury-by-cadence data exists. A real, severe extrapolation, not just a minor caveat."}]',
'preliminary',
'biomechanically_plausible',
'Confidence downgraded from "emerging" to "preliminary" per BOTH checkers independently — the one direct sprint test returned null, and the tibial evidence is from a fundamentally different population (roughly half the cadence range). Treat the hamstring-injury framing as reasonably well-anchored (via the general late-swing mechanism) but the tibial-injury framing as low-confidence extrapolation that should carry a separate, weaker confidence tag, not be bucketed with the hamstring claim.',
'[{"citation":"Chumanov ES, Schache AG, Heiderscheit BC, Thelen DG. Hamstrings are most susceptible to injury during the late swing phase of sprinting. Br J Sports Med. 2012;46:90","url_or_doi":"bjsm.bmj.com","what_it_shows":"Sprint-native, well-established: peak eccentric hamstring loading occurs in late swing during actual sprinting."},{"citation":"Variability of the Sprint Step Movement Pattern and Its Association with Hamstring Injury Risk. J Clin Med. 2026;15(1):281","url_or_doi":"PMC12787177","what_it_shows":"18 Polish national sprinters: \"no direct statistical link was found between individual variability and injury history\" — a null result, self-described by authors as hypothetical, not directly evidenced."},{"citation":"The Influence of Running Cadence on Biomechanics and Injury Prevention: Systematic Review. Cureus. 2025","url_or_doi":"PMC12440572","what_it_shows":"Entire evidence base is distance/recreational runners (150-180 spm); zero sprint-specific studies included — confirms the population mismatch."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'knee_flexion',
'thigh and knee of the swing leg, functionally coupled to the hip',
'Hip flexors (iliopsoas, rectus femoris) as the actual driver; quadriceps regulates rate eccentrically; hamstrings act LATER, in late swing after peak flexion',
'Knee flexion during swing is largely PASSIVE — thigh acceleration from hip flexors whips the shank/foot along; quads control the rate, don''t cause it. IMPORTANT: peak flexion ANGLE does not predict sprint speed or step frequency — only angular VELOCITY does (a 79-sprinter study found a significant regression for angular velocity but explicitly ''not obtained'' for the angle). There is also a TEMPORAL MISMATCH: peak knee flexion occurs at early-to-mid swing, while hamstring injury risk peaks in LATE swing — a different, later moment in the gait cycle. A 2025 paper found peak joint angles are poor predictors of actual hamstring muscle-tendon length change, the proposed injury mechanism.',
'[{"name":"Hamstring strain (weak proxy validity)","mechanism_note":"The temporal mismatch above means this specific angle metric may be measuring the wrong moment in the gait cycle relative to the actual injury-risk window. No study isolates peak flexion angle against prospective injury incidence."}]',
'preliminary',
'biomechanically_plausible',
'Both checkers recommend a MORE skeptical label than "emerging" — not because the mechanism is wrong, but because the specific angle metric has weak-to-absent injury-proxy validity, actively contradicted by a 2025 paper showing peak angles are poor surrogates for the actual proposed mechanism (hamstring length change). Frame all corrective content as general swing-mechanics/hip-flexor conditioning support, not a targeted fix for a proven deficit.',
'[{"citation":"Kinematics of Maximal Speed Sprinting With Different Running Speed, Leg Length, and Step Characteristics. Front Sports Act Living. 2019","url_or_doi":"PMC7739839","what_it_shows":"Minimum swing knee angle: ''a significant regression was not obtained'' for speed/leg length/step frequency; angular VELOCITY was significant."},{"citation":"Vial S, Cochrane Wilkie J, Blazevich AJ, Kadlec D. Peak Lower Limb Joint Angles Are Weak Predictors of Hamstring Length Change. 2025","url_or_doi":"SSRN 5432457","what_it_shows":"Musculoskeletal modeling (14 sprinters): peak sagittal joint angles are poor predictors of actual biarticular hamstring MTU length change during late swing."},{"citation":"Schache AG, et al. Effect of running speed on lower limb joint kinetics. Med Sci Sports Exerc. 2011;43(7):1260-71","url_or_doi":"PMID 21131859","what_it_shows":"Stride-frequency increases at high speed accompanied by hip-flexion torque/power increases — hip flexors, not hamstrings, drive stride-frequency gains."}]',
'partial',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'arm_swing',
'Upper body — shoulder girdle and elbow, coupled to trunk/thoracolumbar rotation',
'Deltoid/shoulder flexor-extensor musculature and scapular stabilizers, working with oblique/paraspinal trunk musculature',
'Active, front-to-back arm swing counterbalances the angular momentum generated by the swinging legs/pelvis. This is CAUSALLY demonstrated: Arellano & Kram 2014 found restricting arm swing raised metabolic cost 3-13% and pelvis rotation 63-102% (exact numbers independently verified). This is PRIMARILY A PERFORMANCE/ECONOMY metric — both checkers independently confirmed injury-risk claims (lumbar rotational stress, shoulder overuse) have NO peer-reviewed injury-epidemiology support, only non-peer-reviewed clinical/blog sourcing.',
'[]',
'emerging',
'causal_mechanism',
'Drop injury-risk framing entirely from athlete-facing content — lead with performance/economy, which is what''s actually evidenced. One complicating finding: Lang et al. 2023 (86 elite junior distance runners) found MORE trunk rotation slightly correlated with BETTER economy (rS=-0.15 to -0.19) — a real, verified, if small, complication to a simple ''less rotation is always better'' story. This is cross-sectional/between-athlete, not a within-athlete causal manipulation like Arellano & Kram, so it tempers prescriptiveness rather than reversing the primary mechanism — don''t force one ''ideal'' amplitude on every athlete.',
'[{"citation":"Arellano CJ, Kram R. The metabolic cost of human running: is swinging the arms worth it? J Exp Biol. 2014;217(14):2456-2463","url_or_doi":"journals.biologists.com/jeb","what_it_shows":"Restricting arm swing: BACK condition +3% metabolic cost/+63% pelvis rotation; CHEST +9%/+102%; HEAD +13%/+101% (all p<0.05). Numbers independently verified exact."},{"citation":"Koo YJ, Ogihara N, Koo S. Active Arm Swing During Running Improves Rotational Stability of the Upper Body and Metabolic Energy Efficiency. Ann Biomed Eng. 2025;53:1003-1013","url_or_doi":"PMC11929735","what_it_shows":"150-muscle simulation: active arm swing lowest cost of transport (5.52 vs 5.73 passive vs 5.82 fixed J/kg路m)."},{"citation":"Lang et al. Relationship between Longitudinal Upper Body Rotation and Energy Cost of Running in Junior Elite Long-Distance Runners. Sports (Basel). 2023;11(10):204","url_or_doi":"MDPI","what_it_shows":"86 junior elite runners: small but significant NEGATIVE correlation (more rotation ~ lower/better energy cost), rS=-0.15 to -0.19."}]',
'confirmed',
'partial',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'knee_valgus',
'knee (frontal plane), with proximal hip/pelvis contribution',
'Hip abductor/external rotator group (gluteus medius, gluteus maximus posterior fibers)',
'This CORRECTS an existing shipping app claim. Stride''s current copy states a lateral-band-walk drill "strengthens glute-med to stop the knee collapsing inward" as settled fact. This is WRONG per direct intervention trials: Snyder et al. 2011 found hip-abductor strengthening in PFPS runners increased strength and reduced pain but produced NO change in peak knee valgus angle during running. Noehren''s own follow-up study found hip strengthening alone did NOT change frontal-plane running mechanics — it took real-time gait retraining with visual/verbal/tactile feedback DURING RUNNING to reduce knee abduction moment (-29%) and valgus excursion (-2.7 deg). A 2025 systematic review concluded evidence is insufficient that hip-strength gains translate to running-gait biomechanical change.',
'[{"name":"Iliotibial band syndrome","mechanism_note":"Best real running-specific link (Noehren, Davis & Hamill 2007, prospective) — but measured hip adduction and knee internal rotation, NOT literally frontal-plane knee valgus angle. A precision nuance, not a full match to this metric."},{"name":"Patellofemoral pain syndrome","mechanism_note":"Genuinely \"controversial\" — multiple reviews use conflicting language; some RCTs show gluteal strengthening improves PFPS symptoms WITHOUT altering kinematics, meaning symptom relief may not run through the valgus-correction mechanism at all."},{"name":"ACL injury/loading","mechanism_note":"Well-established generally, but the evidence base is dominated by jump-landing/cutting-sport studies, not running-specific — an extrapolation, not a running-specific finding."}]',
'emerging',
'correlational',
'Both checkers independently confirmed the hip-strength-vs-valgus literature is genuinely conflicting (2018/2021/2022 systematic reviews all split), and one checker pushed the correction further: at least 2 intervention studies that DIRECTLY tested "strengthen glute med -> less running-gait valgus" (Snyder 2011; Noehren''s strength-only arm) found strength gains WITHOUT the predicted kinematic change. Real-time gait retraining, not strengthening, is what actually changes running-gait valgus in the literature that tested this directly.',
'[{"citation":"Snyder KR, Earl JE, O''Connor KM, Ebersole KT. Resistance training is accompanied by increases in hip strength and changes in lower extremity biomechanics during running. Clin Biomech. 2011;26(7):696-702","url_or_doi":"PMID 21391799","what_it_shows":"Hip-abductor strengthening in PFPS runners: strength up, pain down, NO change in peak knee valgus/genu valgum angle during running."},{"citation":"Willy RW, Davis IS. The effect of a hip-strengthening program on mechanics during running and during a single-leg squat. J Orthop Sports Phys Ther. 2011;41(9):625-632","url_or_doi":"PMID 21765220","what_it_shows":"Hip strengthening improved single-leg squat mechanics and pain but did NOT significantly change running gait mechanics."},{"citation":"Noehren B, Scholz J, Davis I. The effect of real-time gait retraining on hip kinematics, pain and function in PFPS. Br J Sports Med. 2011;45(9):691-696","url_or_doi":"researchgate","what_it_shows":"Real-time visual feedback DURING RUNNING reduced knee abduction moment, hip adduction, and pelvic drop, maintained at 1-month follow-up."},{"citation":"Willy RW, Scholz JP, Davis IS. Mirror gait retraining for the treatment of patellofemoral pain in female runners. Clin Biomech. 2012;27(10):1045-1051","url_or_doi":"sciencedirect","what_it_shows":"Mirror + verbal cueing reduced peak hip adduction, pelvic drop, hip abduction moment, sustained at 1 and 3 months."},{"citation":"Noehren B, Davis I, Hamill J. Prospective study of biomechanical factors associated with iliotibial band syndrome. Clin Biomech. 2007;22(9):951-956","url_or_doi":"ASB award-winner","what_it_shows":"Prospective: greater hip adduction and knee internal rotation (NOT frontal-plane valgus angle per se) predicted later ITBS."}]',
'confirmed',
'confirmed',
NULL,
NULL,
'pilot-2026-08-30-full-batch'
);

