// Decides whether the coach's reply is worth surfacing an "Add to My Calendar"
// button for — via local sentence embeddings (no external API key, no server
// round-trip), not keyword matching. The model never auto-schedules anything;
// this only controls whether the CTA appears. Tapping it is still the only way
// anything gets written to the calendar (see routes/coachSessions.ts).
//
// Runs fully offline after the first call: @xenova/transformers downloads and
// caches a small quantized sentence model (Xenova/all-MiniLM-L6-v2) on first
// use, mirroring the dependency-free spirit of ./knowledge.ts's lexical
// retriever, just with real semantic similarity instead of token overlap.

// Replies that read like a concrete, schedulable plan — NOT questions asking
// whether to schedule one (the model shouldn't need to ask; relevance alone
// decides whether the button shows).
const PLAN_EXEMPLARS = [
  'Here is a two week training plan with workouts for each day.',
  'Do this drill three times a week: high knee wall switches, three sets of ten reps.',
  'Your schedule for this week: Monday sprint intervals, Wednesday tempo run, Friday drills, weekend rest.',
  'I recommend adding these workouts to your training plan this week.',
  'Try this drill program to fix your knee drive over the next two weeks.',
];

// Empirically calibrated against Xenova/all-MiniLM-L6-v2: concrete plan/drill
// replies score ~0.63-0.82 against the exemplars above; a passing mention of
// "workouts" with no actual plan scores ~0.53, praise/nutrition/form-only
// replies score ~0.18-0.42. 0.55 cleanly separates the two.
const SIMILARITY_THRESHOLD = 0.55;

type Extractor = (text: string, opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<Extractor> | null = null;
let exemplarEmbeddingsPromise: Promise<number[][]> | null = null;

async function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = import('@xenova/transformers').then(({ pipeline }) =>
      pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as unknown as Promise<Extractor>,
    );
  }
  return extractorPromise;
}

async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as ArrayLike<number>);
}

async function getExemplarEmbeddings(): Promise<number[][]> {
  if (!exemplarEmbeddingsPromise) {
    exemplarEmbeddingsPromise = Promise.all(PLAN_EXEMPLARS.map(embed));
  }
  return exemplarEmbeddingsPromise;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // both vectors are already normalized, so dot product == cosine similarity
}

/**
 * True if the reply reads like a concrete, schedulable workout/drill plan —
 * i.e. showing an "Add to My Calendar" CTA would make sense. Never throws:
 * if the local embedding model can't load (e.g. no network on first run),
 * fails closed (no CTA) rather than breaking the coach reply.
 */
export async function isCalendarRelevant(replyText: string): Promise<boolean> {
  const text = replyText.trim();
  if (!text) return false;
  try {
    const [replyEmbedding, exemplars] = await Promise.all([embed(text), getExemplarEmbeddings()]);
    const best = Math.max(...exemplars.map((ex) => cosineSimilarity(replyEmbedding, ex)));
    return best >= SIMILARITY_THRESHOLD;
  } catch (err) {
    console.error('isCalendarRelevant: embedding check failed, defaulting to no CTA:', err);
    return false;
  }
}
