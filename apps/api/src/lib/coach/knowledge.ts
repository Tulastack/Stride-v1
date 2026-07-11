// Stride Coach — curated Track & Field knowledge base + a dependency-free
// lexical retriever.
//
// This is what makes the coach "not a ChatGPT wrapper": instead of leaning on
// the base model's fuzzy memory, the agent RETRIEVES from a small, vetted corpus
// of sprint/distance coaching knowledge and grounds every answer in it, citing
// the source. Entries are attributed to well-established bodies of coaching
// science (NSCA, USATF, sprint-biomechanics review literature, the Charlie
// Francis short-to-long system, clinical gait analysis). Keep entries short and
// LLM-friendly; add rows here to widen coverage — retrieval scales automatically.

export interface KnowledgeEntry {
  id: string;
  title: string;
  /** Coarse bucket, used for light query routing. */
  topic:
    | 'mechanics'
    | 'drills'
    | 'race_strategy'
    | 'periodization'
    | 'strength'
    | 'nutrition'
    | 'recovery'
    | 'injury'
    | 'warmup'
    | 'mental';
  /** Event relevance; 'all' matches any event. */
  event: '100m' | '200m' | '400m' | 'distance' | 'all';
  tags: string[];
  content: string;
  /** Honest attribution to a real body of knowledge (not a fabricated DOI). */
  source: string;
}

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'accel-mechanics',
    title: 'Acceleration mechanics (drive phase)',
    topic: 'mechanics',
    event: '100m',
    tags: ['acceleration', 'drive phase', 'shin angle', 'projection', 'start', 'trunk lean', 'first steps'],
    content:
      'In the first ~10–20 m the goal is horizontal force. Run with a large forward body lean (~45° at the first step, gradually rising), positive shin angles (shin pointing forward on ground contact), full hip and knee extension of the drive leg, and a piston-like, pushing action rather than a cyclical one. Steps should progressively lengthen; do not pop upright early. Trunk collapse or standing up too soon kills acceleration.',
    source: 'Sprint biomechanics review literature; USATF acceleration coaching',
  },
  {
    id: 'maxv-mechanics',
    title: 'Max-velocity mechanics (upright sprinting)',
    topic: 'mechanics',
    event: '100m',
    tags: ['max velocity', 'top speed', 'front side mechanics', 'knee drive', 'ground contact', 'posture', 'dorsiflexion'],
    content:
      'At top speed, force is applied briefly and vertically. Cues: tall posture with a neutral pelvis, high knee (front-side mechanics — thigh reaches ~horizontal), a dorsiflexed foot that strikes under or just ahead of the hips, and a fast "stepping over the opposite knee" recovery. Short ground-contact times (~0.08–0.10 s for elites) and stiff, springy ankles matter more than reaching/overstriding. Overstriding (foot landing well ahead of the center of mass) brakes the athlete.',
    source: 'Sprint biomechanics review literature (e.g., front-side mechanics model)',
  },
  {
    id: 'arm-action',
    title: 'Arm action in sprinting',
    topic: 'mechanics',
    event: 'all',
    tags: ['arms', 'arm swing', 'shoulders', 'cadence', 'rhythm'],
    content:
      'Arms drive from the shoulder with ~90° elbows, hand traveling from cheek to hip pocket, relaxed hands. Arms counterbalance the legs and help set cadence — a faster, compact arm drive supports a higher stride frequency. Avoid crossing the midline (causes rotation) and avoid tensing the hands/traps.',
    source: 'USATF sprint coaching fundamentals',
  },
  {
    id: 'cadence-vs-stride',
    title: 'Cadence vs stride length',
    topic: 'mechanics',
    event: 'all',
    tags: ['cadence', 'stride length', 'stride frequency', 'spm', 'speed equation'],
    content:
      'Speed = stride length × stride frequency. Both matter, but chasing stride length by reaching forward usually overstrides and slows you down. Most amateurs improve fastest by raising cadence (quicker turnover) while keeping ground contact under the hips. Elite sprinters combine long strides with high frequency because they produce large force in a very short contact time.',
    source: 'Running/sprint biomechanics reviews',
  },
  {
    id: 'ground-contact-stiffness',
    title: 'Ground contact time and leg stiffness',
    topic: 'mechanics',
    event: 'all',
    tags: ['ground contact time', 'gct', 'stiffness', 'reactive', 'plyometric', 'bounce'],
    content:
      'Shorter ground-contact time with a stiff, reactive ankle/lower limb is associated with faster running and better economy. It is trained with plyometrics (pogo hops, ankle stiffness drills, wickets) and by cueing a quick, elastic "off the ground fast" contact rather than a soft, collapsing one. Do not confuse short contact with tiny steps — it is about elastic recoil.',
    source: 'Spring-mass model of running; plyometric training literature',
  },
  {
    id: 'overstriding-flaw',
    title: 'Overstriding — why it is a flaw',
    topic: 'mechanics',
    event: 'all',
    tags: ['overstriding', 'braking', 'heel strike', 'foot ahead', 'injury', 'flaw'],
    content:
      'Overstriding means the foot lands well ahead of the center of mass, creating a braking (backward) ground reaction force and often a hard heel strike, increasing loading on the knee and shin. Fix by increasing cadence, cueing the foot to land under the hips, and strengthening posterior chain / hip extensors. Wicket runs and dribble drills groove a foot-under-hips contact.',
    source: 'Running gait analysis; clinical/rehab literature',
  },
  {
    id: 'hip-extension-flaw',
    title: 'Limited hip extension at toe-off',
    topic: 'mechanics',
    event: 'all',
    tags: ['hip extension', 'toe-off', 'glutes', 'push', 'flaw', 'power'],
    content:
      'Incomplete hip extension at toe-off shortens the propulsive push and effective stride. Common causes are weak/underactive glutes, tight hip flexors, or a cyclical instead of pushing action in acceleration. Address with dribble-to-bound build-ups, hip-flexor mobility, and glute/posterior-chain strength (hip thrusts, RDLs).',
    source: 'Sprint mechanics coaching; strength & conditioning literature',
  },
  {
    id: 'drill-a-skips',
    title: 'A-skips / high-knee drills',
    topic: 'drills',
    event: 'all',
    tags: ['a-skip', 'high knee', 'knee drive', 'posture', 'rhythm', 'drill'],
    content:
      'A-skips teach front-side mechanics: drive the knee to hip height, dorsiflexed foot, tall posture, and a rhythmic step-down under the hips. Cue "punch the knee up, snap the foot down under your hip." Typical dose: 3 × 20 m. Progress to A-runs for higher speed carryover.',
    source: 'USATF sprint drill progressions',
  },
  {
    id: 'drill-wickets',
    title: 'Wicket runs',
    topic: 'drills',
    event: 'all',
    tags: ['wickets', 'mini hurdles', 'cadence', 'ground contact', 'front side', 'drill'],
    content:
      'Wickets (evenly spaced mini-hurdles) force a high knee, quick turnover, and a foot strike under the hips — training rhythm and short ground contact at speed. Spacing is set to the athlete\'s max-velocity stride. Cue "quick feet, step over the wicket, land under you." Great for fixing overstriding and low cadence.',
    source: 'USATF / speed-development coaching',
  },
  {
    id: 'drill-wall-drives',
    title: 'Wall drives',
    topic: 'drills',
    event: '100m',
    tags: ['wall drive', 'acceleration', 'shin angle', 'trunk lean', 'drive phase', 'drill'],
    content:
      'Wall drives train the acceleration position: hands on a wall, body in a straight line at ~45°, alternately driving knees up and pushing the ground back with full extension. Cue "stay long and low, push the floor away." Isolates the drive-phase posture without the balance demands of sprinting.',
    source: 'Acceleration development coaching',
  },
  {
    id: 'drill-dribble-bound',
    title: 'Dribble-to-bound build-ups',
    topic: 'drills',
    event: 'all',
    tags: ['dribble', 'bound', 'hip extension', 'ankle stiffness', 'transition', 'drill'],
    content:
      'Ankle dribbles progress into bounds to train hip extension and elastic push-off. Start with low, quick ankling and gradually lengthen into powerful bounds while keeping contacts crisp. Cue "feel the back leg finish long behind you." Builds the push and stiffness for late acceleration and top speed.',
    source: 'Plyometric / sprint transition drills',
  },
  {
    id: 'block-start',
    title: 'Block start basics',
    topic: 'race_strategy',
    event: '100m',
    tags: ['blocks', 'start', 'set position', 'reaction', 'first move', 'clearance'],
    content:
      'In the set position, hips slightly above shoulders, weight forward over the hands, shins driving into the blocks. On the gun, push both feet hard and drive the lead-arm/opposite-knee aggressively, exiting at a low angle. Do not stand up — the first steps should be pushed, not reached. Reaction is trained; block clearance angle is trained with wall drives and sled pushes.',
    source: 'USATF sprint start coaching',
  },
  {
    id: 'race-100',
    title: '100 m race model',
    topic: 'race_strategy',
    event: '100m',
    tags: ['100m', 'race plan', 'phases', 'acceleration', 'max velocity', 'speed endurance'],
    content:
      'A 100 m is roughly: reaction + block clearance, acceleration (0–30 m), transition to upright, max velocity (~30–60 m; even elites cannot hold top speed the whole way), and speed-endurance/maintenance (60–100 m) where the goal is to decelerate the least. Amateurs often over-tense at the end — cue relaxation ("fast and loose") to preserve mechanics.',
    source: 'Sprint race-phase modeling',
  },
  {
    id: 'race-200',
    title: '200 m race model',
    topic: 'race_strategy',
    event: '200m',
    tags: ['200m', 'bend', 'curve', 'race plan', 'speed endurance', 'lean'],
    content:
      'The 200 m combines curve running and speed endurance. Run the bend aggressively but relaxed, leaning into the turn and driving the outside arm. Accelerate off the bend into the straight, then focus on relaxed maintenance. The last 50 m is about decelerating least — trained with speed-endurance reps (120–150 m).',
    source: 'Sprint event coaching',
  },
  {
    id: 'race-400',
    title: '400 m race model and energy distribution',
    topic: 'race_strategy',
    event: '400m',
    tags: ['400m', 'pacing', 'speed endurance', 'lactate', 'even split', 'rhythm'],
    content:
      'The 400 m is a long sprint: aim for a controlled fast first 200 m (typically ~1–2 s faster than the second) with relaxed, rhythmic mechanics, then hold form as fatigue hits. Do not sprint the first 100 m all-out. Training emphasizes special endurance (150–300 m reps) and lactate tolerance. Late-race form breakdown is the main time-loss — cue posture and arm drive when tired.',
    source: 'USATF 400 m / long-sprint coaching',
  },
  {
    id: 'periodization-short-to-long',
    title: 'Short-to-long vs long-to-short periodization',
    topic: 'periodization',
    event: 'all',
    tags: ['periodization', 'gpp', 'spp', 'short to long', 'long to short', 'planning', 'season'],
    content:
      'Two classic sprint models. Short-to-long (Charlie Francis style) develops max speed early with short, high-quality sprints and extends toward event distance over the season. Long-to-short builds a large volume/endurance base first, then sharpens speed. Both alternate high-intensity (speed/CNS) days with low-intensity (tempo/recovery) days and avoid the "grey zone" of medium-hard everything.',
    source: 'Charlie Francis system; sprint periodization literature',
  },
  {
    id: 'high-low-planning',
    title: 'High/Low training organization',
    topic: 'periodization',
    event: 'all',
    tags: ['high low', 'cns', 'recovery', 'tempo', 'intensity', 'weekly plan', 'hard days'],
    content:
      'Organize the week by CNS intensity, not muscle groups. High-intensity days (max-velocity sprints, starts, heavy lifts, plyos) need ~48 h between them; fill the gaps with low-intensity work (extensive tempo at 65–75%, mobility, general strength) that aids recovery. Avoid stacking more than 2 truly hard days in a row.',
    source: 'Charlie Francis high/low model',
  },
  {
    id: 'tapering',
    title: 'Tapering for a peak',
    topic: 'periodization',
    event: 'all',
    tags: ['taper', 'peak', 'competition', 'volume', 'freshness', 'championship'],
    content:
      'To peak, reduce training volume substantially (often ~40–60%) over ~1–2 weeks while keeping intensity high and quality sharp. The goal is freshness without detraining. Keep some max-velocity exposure and starts; cut the extensive tempo volume. Sleep and nutrition become even more important during the taper.',
    source: 'Tapering research; peaking practice',
  },
  {
    id: 'strength-for-speed',
    title: 'Strength training for sprinters',
    topic: 'strength',
    event: 'all',
    tags: ['strength', 'squat', 'power clean', 'rfd', 'plyometrics', 'weights', 'force'],
    content:
      'Sprinting is a force-in-short-time skill. Prioritize heavy compound lifts (squat, trap-bar deadlift, hip thrust) for maximal force, explosive lifts/jumps (cleans, trap-bar jumps, box jumps) for rate of force development, and plyometrics for elastic stiffness. Keep reps low and quality high; lift on high-intensity days so low days stay easy. Strength supports speed — it does not replace sprinting.',
    source: 'NSCA strength & conditioning for speed',
  },
  {
    id: 'warmup-ramp',
    title: 'RAMP warm-up',
    topic: 'warmup',
    event: 'all',
    tags: ['warmup', 'ramp', 'activation', 'dynamic', 'drills', 'preparation', 'primer'],
    content:
      'Use RAMP: Raise (easy jog/skips to raise temperature and HR), Activate & Mobilize (dynamic mobility, glute/hip activation, leg swings), Potentiate (build-ups, drills like A-skips, a few accelerations ramping to race pace). Avoid long static stretching before sprinting. A good warm-up primes the CNS and reduces injury risk.',
    source: 'NSCA RAMP warm-up protocol',
  },
  {
    id: 'hamstring-injury',
    title: 'Hamstring strain prevention',
    topic: 'injury',
    event: 'all',
    tags: ['hamstring', 'injury', 'nordic', 'eccentric', 'prevention', 'pain', 'strain'],
    content:
      'Hamstring strains are the most common sprint injury, usually in late swing when the hamstring decelerates the shin eccentrically. Prevention: eccentric strength (Nordic hamstring curls), high-speed running exposure (do not avoid sprinting), posterior-chain strength, and good warm-up. Any sharp posterior-thigh pain warrants rest and a professional assessment — never train through it.',
    source: 'Sports-medicine hamstring injury literature',
  },
  {
    id: 'achilles-shin',
    title: 'Achilles / shin overuse management',
    topic: 'injury',
    event: 'all',
    tags: ['achilles', 'shin splints', 'calf', 'overuse', 'load management', 'tendon', 'pain'],
    content:
      'Achilles and shin complaints are usually load-management problems — too much sprint/plyo volume increased too quickly on hard surfaces. Manage by progressing volume gradually, adding calf/tibialis strength, ensuring recovery between high days, and rotating surfaces/footwear. Persistent tendon pain needs a professional; do not push through worsening pain.',
    source: 'Tendon load-management / clinical guidance',
  },
  {
    id: 'nutrition-fueling',
    title: 'Fueling and hydration for track',
    topic: 'nutrition',
    event: 'all',
    tags: ['nutrition', 'hydration', 'carbs', 'protein', 'pre race', 'recovery meal', 'fuel'],
    content:
      'Sprinting is glycolytic/anaerobic but training days still need carbohydrate to fuel quality. General guidance: adequate daily carbs around hard sessions, ~1.6–2.2 g/kg/day protein for recovery and muscle, a carb-focused meal 2–3 h pre-session, and rehydration plus carbs+protein within ~1–2 h after. Hydrate through the day (pale-yellow urine as a rough gauge), not just at the track.',
    source: 'Sports-nutrition position stands (general guidance, not individualized)',
  },
  {
    id: 'recovery-sleep',
    title: 'Recovery and sleep',
    topic: 'recovery',
    event: 'all',
    tags: ['recovery', 'sleep', 'adaptation', 'rest day', 'cns', 'fatigue', 'overtraining'],
    content:
      'Adaptation happens during recovery, not the session. Sleep (~8–9 h for athletes) is the highest-leverage recovery tool for a CNS-taxing sport like sprinting. Space high-intensity days, use low-intensity tempo/mobility to promote blood flow, and treat rising resting HR, poor sleep, and persistent heaviness as signs to back off. Rest days are training.',
    source: 'Sleep & recovery in athletes literature',
  },
  {
    id: 'mental-race',
    title: 'Mental performance and relaxation',
    topic: 'mental',
    event: 'all',
    tags: ['mental', 'relaxation', 'focus', 'cues', 'nerves', 'confidence', 'arousal'],
    content:
      'Sprinting fast requires relaxation — tension slows you down. Use one or two simple external cues (e.g., "tall", "quick feet") rather than thinking about many things. Manage pre-race arousal with breathing and a consistent routine. Confidence comes from preparation; trust your training and let the race happen instead of forcing it.',
    source: 'Sport-psychology performance practice',
  },
];

// ─── Lexical retrieval (no embeddings, no external calls) ───────────

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'my', 'me', 'i', 'is', 'it',
  'how', 'do', 'what', 'should', 'can', 'you', 'your', 'with', 'at', 'be', 'get', 'am', 'are',
  'this', 'that', 'about', 'when', 'why', 'which', 'more', 'better', 'good', 'best',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// Precompute a searchable token bag per entry (title + tags weighted heavier).
const INDEX = KNOWLEDGE.map((e) => {
  const bag = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const t of tokenize(text)) bag.set(t, (bag.get(t) ?? 0) + weight);
  };
  add(e.title, 3);
  add(e.tags.join(' '), 3);
  add(e.topic, 2);
  add(e.content, 1);
  return { entry: e, bag };
});

export interface RetrievedChunk {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
}

/**
 * Return the top-K knowledge entries most relevant to `query`, optionally
 * boosting entries for the athlete's event. Pure and fast — safe to call every
 * turn. Returns [] when nothing scores above zero.
 */
export function retrieveKnowledge(
  query: string,
  opts: { topK?: number; event?: string | null } = {},
): RetrievedChunk[] {
  const topK = opts.topK ?? 4;
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const event = (opts.event ?? '').toLowerCase();

  const scored = INDEX.map(({ entry, bag }) => {
    let score = 0;
    for (const t of qTokens) score += bag.get(t) ?? 0;
    // Light event boost so a 400 m athlete gets 400 m-flavored answers.
    if (event && (entry.event === event)) score *= 1.25;
    return { entry, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ entry, score }) => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    source: entry.source,
    score: Math.round(score * 100) / 100,
  }));
}
