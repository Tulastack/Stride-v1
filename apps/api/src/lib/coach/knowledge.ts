// Stride Coach, curated Track & Field knowledge base + a dependency-free
// lexical retriever.
//
// This is what makes the coach "not a ChatGPT wrapper": instead of leaning on
// the base model's fuzzy memory, the agent RETRIEVES from a small, vetted corpus
// of sprint/distance coaching knowledge and grounds every answer in it, citing
// the source. Entries are attributed to well-established bodies of coaching
// science (NSCA, USATF, sprint-biomechanics review literature, the Charlie
// Francis short-to-long system, clinical gait analysis). Keep entries short and
// LLM-friendly; add rows here to widen coverage, retrieval scales automatically.

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
    | 'mental'
    | 'recruiting';
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
      'At top speed, force is applied briefly and vertically. Cues: tall posture with a neutral pelvis, high knee (front-side mechanics, thigh reaches ~horizontal), a dorsiflexed foot that strikes under or just ahead of the hips, and a fast "stepping over the opposite knee" recovery. Short ground-contact times (~0.08–0.10 s for elites) and stiff, springy ankles matter more than reaching/overstriding. Overstriding (foot landing well ahead of the center of mass) brakes the athlete.',
    source: 'Sprint biomechanics review literature (e.g., front-side mechanics model)',
  },
  {
    id: 'arm-action',
    title: 'Arm action in sprinting',
    topic: 'mechanics',
    event: 'all',
    tags: ['arms', 'arm swing', 'shoulders', 'cadence', 'rhythm'],
    content:
      'Arms drive from the shoulder with ~90° elbows, hand traveling from cheek to hip pocket, relaxed hands. Arms counterbalance the legs and help set cadence, a faster, compact arm drive supports a higher stride frequency. Avoid crossing the midline (causes rotation) and avoid tensing the hands/traps.',
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
      'Shorter ground-contact time with a stiff, reactive ankle/lower limb is associated with faster running and better economy. It is trained with plyometrics (pogo hops, ankle stiffness drills, wickets) and by cueing a quick, elastic "off the ground fast" contact rather than a soft, collapsing one. Do not confuse short contact with tiny steps, it is about elastic recoil.',
    source: 'Spring-mass model of running; plyometric training literature',
  },
  {
    id: 'overstriding-flaw',
    title: 'Overstriding, why it is a flaw',
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
      'Wickets (evenly spaced mini-hurdles) force a high knee, quick turnover, and a foot strike under the hips, training rhythm and short ground contact at speed. Spacing is set to the athlete\'s max-velocity stride. Cue "quick feet, step over the wicket, land under you." Great for fixing overstriding and low cadence.',
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
      'In the set position, hips slightly above shoulders, weight forward over the hands, shins driving into the blocks. On the gun, push both feet hard and drive the lead-arm/opposite-knee aggressively, exiting at a low angle. Do not stand up, the first steps should be pushed, not reached. Reaction is trained; block clearance angle is trained with wall drives and sled pushes.',
    source: 'USATF sprint start coaching',
  },
  {
    id: 'race-100',
    title: '100 m race model',
    topic: 'race_strategy',
    event: '100m',
    tags: ['100m', 'race plan', 'phases', 'acceleration', 'max velocity', 'speed endurance'],
    content:
      'A 100 m is roughly: reaction + block clearance, acceleration (0–30 m), transition to upright, max velocity (~30–60 m; even elites cannot hold top speed the whole way), and speed-endurance/maintenance (60–100 m) where the goal is to decelerate the least. Amateurs often over-tense at the end, cue relaxation ("fast and loose") to preserve mechanics.',
    source: 'Sprint race-phase modeling',
  },
  {
    id: 'race-200',
    title: '200 m race model',
    topic: 'race_strategy',
    event: '200m',
    tags: ['200m', 'bend', 'curve', 'race plan', 'speed endurance', 'lean'],
    content:
      'The 200 m combines curve running and speed endurance. Run the bend aggressively but relaxed, leaning into the turn and driving the outside arm. Accelerate off the bend into the straight, then focus on relaxed maintenance. The last 50 m is about decelerating least, trained with speed-endurance reps (120–150 m).',
    source: 'Sprint event coaching',
  },
  {
    id: 'race-400',
    title: '400 m race model and energy distribution',
    topic: 'race_strategy',
    event: '400m',
    tags: ['400m', 'pacing', 'speed endurance', 'lactate', 'even split', 'rhythm'],
    content:
      'The 400 m is a long sprint: aim for a controlled fast first 200 m (typically ~1–2 s faster than the second) with relaxed, rhythmic mechanics, then hold form as fatigue hits. Do not sprint the first 100 m all-out. Training emphasizes special endurance (150–300 m reps) and lactate tolerance. Late-race form breakdown is the main time-loss, cue posture and arm drive when tired.',
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
      'Sprinting is a force-in-short-time skill. Prioritize heavy compound lifts (squat, trap-bar deadlift, hip thrust) for maximal force, explosive lifts/jumps (cleans, trap-bar jumps, box jumps) for rate of force development, and plyometrics for elastic stiffness. Keep reps low and quality high; lift on high-intensity days so low days stay easy. Strength supports speed, it does not replace sprinting.',
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
      'Hamstring strains are the most common sprint injury, usually in late swing when the hamstring decelerates the shin eccentrically. Prevention: eccentric strength (Nordic hamstring curls), high-speed running exposure (do not avoid sprinting), posterior-chain strength, and good warm-up. Any sharp posterior-thigh pain warrants rest and a professional assessment, never train through it.',
    source: 'Sports-medicine hamstring injury literature',
  },
  {
    id: 'achilles-shin',
    title: 'Achilles / shin overuse management',
    topic: 'injury',
    event: 'all',
    tags: ['achilles', 'shin splints', 'calf', 'overuse', 'load management', 'tendon', 'pain'],
    content:
      'Achilles and shin complaints are usually load-management problems, too much sprint/plyo volume increased too quickly on hard surfaces. Manage by progressing volume gradually, adding calf/tibialis strength, ensuring recovery between high days, and rotating surfaces/footwear. Persistent tendon pain needs a professional; do not push through worsening pain.',
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
      'Sprinting fast requires relaxation, tension slows you down. Use one or two simple external cues (e.g., "tall", "quick feet") rather than thinking about many things. Manage pre-race arousal with breathing and a consistent routine. Confidence comes from preparation; trust your training and let the race happen instead of forcing it.',
    source: 'Sport-psychology performance practice',
  },
  {
    id: 'recruiting',
    title: 'College recruiting for sprinters',
    topic: 'recruiting',
    event: 'all',
    tags: ['recruit', 'recruiting', 'college', 'scholarship', 'ncaa', 'coaches', 'next level', 'eligibility'],
    content:
      'College coaches recruit on verified marks: fully automatic timed (FAT) results from sanctioned meets, posted on results sites coaches already use, count far more than hand times or training times. Register with the NCAA Eligibility Center (or the NAIA equivalent) and keep grades and core courses on track, since academics decide eligibility and often aid. Build a short list of programs whose current athletes run times near yours, then email those coaches directly with your events, verified marks, upcoming meets, grades and a race video. Follow up after each new best. Consistent improvement across a season is a strong signal on its own.',
    source: 'NCAA Eligibility Center guidance and common collegiate recruiting practice',
  },
];

// ─── Lexical retrieval (no embeddings, no external calls) ───────────
//
// BM25F-style ranking (Robertson & Zaragoza 2009): per-field weighted term
// frequency with saturation and length normalisation, so one entry that
// repeats a word cannot outrank one that matches the whole question. On a
// corpus this small, BM25 with a domain thesaurus is a strong, zero-latency
// baseline (BEIR, Thakur et al. 2021); dense embeddings would add a network
// call per turn for little gain. Coaching vocabulary is normalised first, so
// "warm-up", "warm up" and "warmup" are one term, and "top speed" finds the
// max-velocity entry.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'my', 'me', 'i', 'is', 'it',
  'how', 'do', 'what', 'should', 'can', 'you', 'your', 'with', 'at', 'be', 'get', 'am', 'are',
  'this', 'that', 'about', 'when', 'why', 'which', 'more', 'better', 'good', 'best', 'does',
  'did', 'im', 'ive', 'any', 'some', 'tips', 'help', 'want', 'need', 'make', 'way', 'like',
  'just', 'really', 'give', 'tell', 'should', 'could', 'would', 'will', 'from', 'have', 'has',
  'before', 'during', 'while', 'there', 'than', 'much', 'many', 'often', 'too', 'very',
]);

// Multi-word coaching phrases → one canonical term (applied to docs AND queries).
const PHRASES: [RegExp, string][] = [
  [/\bwarm[\s-]?ups?\b|\bwarming up\b/g, ' warmup '],
  [/\bcool[\s-]?downs?\b/g, ' cooldown '],
  [/\b(top|max(imum)?)[\s-](speed|velocity)\b|\bupright sprint(ing)?\b/g, ' maxvelocity '],
  [/\bground[\s-]contact( time)?\b|\bcontact[\s-]time\b|\bgct\b/g, ' groundcontact '],
  [/\bknee[\s-](drive|lift)\b|\bhigh[\s-]knees?\b/g, ' kneedrive '],
  [/\bhip[\s-]extension\b|\btoe[\s-]off\b/g, ' hipextension '],
  [/\b(trunk|torso|forward|body)[\s-]lean\b/g, ' trunklean '],
  [/\bknee[\s-](valgus|collapse|cave)\b|\bknees? cav(e|ing)\b|\bvalgus\b/g, ' kneevalgus '],
  [/\b(pelvic|hip)[\s-]drop\b/g, ' pelvicdrop '],
  [/\bover[\s-]?strid(e|es|ing)\b/g, ' overstride '],
  [/\bblock[\s-]starts?\b|\bstarting blocks\b|\bset position\b|\bblocks\b/g, ' blockstart '],
  [/\bstride[\s-](frequency|rate)\b|\bturnover\b|\bsteps per minute\b|\bspm\b/g, ' cadence '],
  [/\barm[\s-](swing|action|drive)\b|\barms\b/g, ' armswing '],
  [/\bshin[\s-]splints?\b/g, ' shinsplints '],
  [/\bspeed[\s-]endurance\b/g, ' speedendurance '],
  [/\bmini[\s-]hurdles?\b/g, ' wickets '],
  [/\bfront[\s-]side\b/g, ' frontside '],
];

// Single-word synonyms → canonical term. Kept to unambiguous coaching usage.
const SYNONYMS: Record<string, string> = {
  hurt: 'pain', hurts: 'pain', sore: 'pain', soreness: 'pain', ache: 'pain', aches: 'pain', injured: 'injury',
  eat: 'nutrition', eating: 'nutrition', food: 'nutrition', diet: 'nutrition', meal: 'nutrition', meals: 'nutrition',
  fuel: 'nutrition', fueling: 'nutrition', fuelling: 'nutrition', carb: 'carbs', drink: 'hydration', water: 'hydration',
  hydrate: 'hydration', sleeping: 'sleep', tired: 'fatigue', exhausted: 'fatigue',
  nervous: 'nerves', anxiety: 'nerves', anxious: 'nerves', pressure: 'nerves', confident: 'confidence',
  lifting: 'strength', lift: 'strength', gym: 'strength', weights: 'strength', squats: 'squat',
  plyos: 'plyometrics', plyo: 'plyometrics', jumps: 'plyometrics', bounding: 'bound', bounds: 'bound',
  peaking: 'peak', taper: 'tapering', season: 'periodization', schedule: 'planning', program: 'planning',
  pace: 'pacing', splits: 'pacing', curve: 'bend', accelerate: 'acceleration', accel: 'acceleration',
  drive: 'acceleration', starts: 'start', reaction: 'start', hammy: 'hamstring', hamstrings: 'hamstring',
  calves: 'calf', tendon: 'achilles', stretch: 'mobility', stretching: 'mobility',
  flexibility: 'mobility', mindset: 'mental', meet: 'race', meets: 'race', competition: 'race',
};

/** Light suffix stripping so "drills"/"drill" and "sprinting"/"sprint" meet. */
function stem(t: string): string {
  if (t.length > 5 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 5 && t.endsWith('ed') && !t.endsWith('eed')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('es') && !t.endsWith('ses')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

function tokenize(s: string): string[] {
  let text = ` ${s.toLowerCase()} `;
  for (const [re, canon] of PHRASES) text = text.replace(re, canon);
  return text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map((t) => SYNONYMS[t] ?? t)
    .map(stem);
}

/** A retrievable document: a knowledge entry or a library drill. */
export interface EvidenceDoc {
  id: string;
  title: string;
  content: string;
  source: string;
  kind: 'knowledge' | 'drill';
  event?: string;
  /** Field texts with their BM25F weights. */
  fields: [string, number][];
}

export function knowledgeDoc(e: KnowledgeEntry): EvidenceDoc {
  return {
    id: e.id, title: e.title, content: e.content, source: e.source, kind: 'knowledge', event: e.event,
    fields: [[e.title, 3], [e.tags.join(' '), 3], [e.topic, 1.5], [e.content, 1]],
  };
}

/** A reference_drills row as a retrievable document. */
export function drillDoc(d: {
  key: string; name: string; description?: string | null; cues?: unknown; target_metrics?: unknown; contraindications?: unknown;
}): EvidenceDoc {
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join('; ') : '');
  const targets = list(d.target_metrics).replace(/_/g, ' ');
  const content = [d.description, list(d.cues) && `Cues: ${list(d.cues)}.`, list(d.contraindications) && `Cautions: ${list(d.contraindications)}.`]
    .filter(Boolean).join(' ');
  return {
    id: d.key, title: `${d.name} (drill, key ${d.key})`, content, source: 'Stride reference drill library', kind: 'drill',
    fields: [[d.name, 3], [`${targets} drill`, 3], [content, 1]],
  };
}

interface IndexedDoc { doc: EvidenceDoc; tf: Map<string, number>; len: number }

const K1 = 1.2;
const B = 0.75;

function indexDocs(docs: EvidenceDoc[]): { docs: IndexedDoc[]; df: Map<string, number>; avgLen: number } {
  const indexed = docs.map((doc) => {
    const tf = new Map<string, number>();
    let len = 0;
    for (const [text, w] of doc.fields) {
      for (const t of tokenize(text)) { tf.set(t, (tf.get(t) ?? 0) + w); len += w; }
    }
    return { doc, tf, len };
  });
  const df = new Map<string, number>();
  for (const d of indexed) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLen = indexed.reduce((s, d) => s + d.len, 0) / Math.max(indexed.length, 1);
  return { docs: indexed, df, avgLen };
}

const BASE_INDEX = indexDocs(KNOWLEDGE.map(knowledgeDoc));

export interface RetrievedChunk {
  id: string;
  title: string;
  content: string;
  source: string;
  score: number;
  kind?: 'knowledge' | 'drill';
  /** IDF-weighted share of the question's known terms this entry covers (0-1). */
  coverage?: number;
}

/**
 * Relevance grade for a result set, a lexical stand-in for CRAG's retrieval
 * evaluator (Yan et al. 2024): 'strong' when the top entry covers most of the
 * question, 'weak' when it only touches it, 'none' when nothing matched. The
 * coach is told the grade so weak evidence is hedged instead of over-trusted.
 */
export type EvidenceGrade = 'strong' | 'weak' | 'none';

export function gradeEvidence(hits: RetrievedChunk[]): EvidenceGrade {
  if (!hits.length) return 'none';
  return (hits[0].coverage ?? 0) >= 0.5 ? 'strong' : 'weak';
}

/**
 * Return the top-K entries most relevant to `query`, optionally boosting the
 * athlete's event, over the knowledge base plus any `extra` documents (the
 * drill library). Pure and fast, safe to call every turn. Returns [] when
 * nothing matches.
 */
export function retrieveKnowledge(
  query: string,
  opts: { topK?: number; event?: string | null; extra?: EvidenceDoc[]; exclude?: Set<string> } = {},
): RetrievedChunk[] {
  const topK = opts.topK ?? 4;
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0) return [];
  const event = (opts.event ?? '').toLowerCase();
  const index = opts.extra?.length ? indexDocs([...KNOWLEDGE.map(knowledgeDoc), ...opts.extra]) : BASE_INDEX;
  const N = index.docs.length;
  const idf = (t: string) => {
    const n = index.df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };
  // Coverage weighs terms by IDF, so a distinctive term ("sleep") counts for
  // more than a generic one ("race"). A word no document contains gets the
  // full weight: it is part of the question nothing here answers.
  const totalIdf = qTerms.reduce((s, t) => s + idf(t), 0) || 1;

  const scored = index.docs
    .filter(({ doc }) => !opts.exclude?.has(doc.id))
    .map(({ doc, tf, len }) => {
      let score = 0;
      let matchedIdf = 0;
      for (const t of qTerms) {
        const f = tf.get(t);
        if (!f) continue;
        matchedIdf += idf(t);
        score += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / index.avgLen))));
      }
      // Light event boost so a 400 m athlete gets 400 m-flavored answers.
      if (event && doc.event === event) score *= 1.25;
      return { doc, score, coverage: matchedIdf / totalIdf };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ doc, score, coverage }) => ({
    id: doc.id,
    title: doc.title,
    content: doc.content,
    source: doc.source,
    kind: doc.kind,
    score: Math.round(score * 100) / 100,
    coverage: Math.round(coverage * 100) / 100,
  }));
}
