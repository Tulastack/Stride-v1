// Stride Coach, intent router.
//
// Decides, before any model call, which workflow a message needs. Two lines of
// research motivate it:
//   • Adaptive-RAG (Jeong et al., NAACL 2024): route each query by complexity
//     to no retrieval, single-step retrieval or multi-step tool use, rather
//     than running the most expensive loop for everything.
//   • "Building effective agents" (Anthropic, 2024): prefer predictable
//     workflows (routing, then a fixed evidence step) and keep the open-ended
//     agent loop for the parts that genuinely need it, here: calendar and app
//     changes that depend on IDs read in the same turn.
// The router is deterministic keyword scoring, so it costs microseconds and
// no tokens. Intents are multi-label: "what drill fixes my knee drive, and put
// it on Tuesday" is form + drill + plan.

export type Intent =
  | 'form'        // their analysis, what to fix, their numbers
  | 'progress'    // trends across analyses
  | 'drill'       // drills, exercises, sets/reps
  | 'plan'        // their calendar / scheduling / changing sessions
  | 'knowledge'   // general track and field coaching questions
  | 'injury'      // pain, injury, recovery status
  | 'profile'     // name, event, PB, level
  | 'app'         // navigation, appearance, settings, app help
  | 'suggestions';// pending drill suggestions from an analysis

const RULES: [Intent, RegExp][] = [
  ['form', /\b(my (run|form|clip|video|analysis|report|score|technique|mechanics|numbers|metrics|stride|running)|fix first|what (should|do) i (fix|work on|improve)|wrong with|how (is|was|did) (my|i)|knee drive|trunk lean|hip extension|overstrid|cadence|ground contact|contact time|arm swing|knee flexion|valgus|pelvic drop|vertical oscillation|trusted|economy)\b/i],
  ['progress', /\b(progress|improv(ed|ing)|trend|over time|getting better|getting worse|compared? to (last|before)|since last|history|last (few|couple) (runs|analyses|weeks))\b/i],
  ['drill', /\b(drills?|exercises?|sets?|reps?|wickets|a-?skips?|bounds?|dribbles?|wall drives?|how (do|should) i (train|practice)|workout for)\b/i],
  ['plan', /\b(calendar|schedul\w*|plan|week|weekly|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|move|reschedul\w*|cancel|delete|add (it|this|that|them)|put (it|this|that|them)|session|workouts?|rest day|mark (it|this|that)? ?(done|complete))\b/i],
  ['injury', /\b(pain|hurts?|injur\w*|sore|strain|pulled|tweak\w*|ache|tight(ness)?|stiff(ness)?|cramp\w*|recover(y|ing) (from|mode)|is_injured|back from)\b/i],
  ['profile', /\b(my (name|event|pb|personal best|level|profile)|i (run|do) the \d{3}m|change my (event|name|pb|level)|update my (event|name|pb|profile|level))\b/i],
  ['app', /\b(dark mode|light mode|appearance|theme|reduce(d)? motion|open|go to|navigate|take me|settings|capture|record (a|my)|upload|where (is|do i)|how do i use|app)\b/i],
  ['suggestions', /\b(suggest(ion|ed)s?|approve|skip (it|the|that)|recommended drills?|pending)\b/i],
  ['knowledge', /\b(how|why|what|when|should|best|tips?|explain|warm ?-?up|race|pacing|start|blocks|acceleration|top speed|max velocity|periodi[sz]ation|taper|strength|lift|plyo\w*|nutrition|eat|food|hydrat\w*|sleep|recovery|mental|nerves|recruit\w*|college|100m|200m|400m|hurdles?|relay)\b/i],
];

/** Follow-ups that lean on the previous turn ("how many sets?", "do that Tuesday"). */
const ANAPHORA = /\b(that|it|this|those|them|these|same|again|more|also|instead|then)\b/i;

export interface Route {
  intents: Set<Intent>;
  /** True when the reply may need to read IDs and propose a change this turn. */
  needsActions: boolean;
  /** A direct request to change something ("turn on dark mode", "approve it"). */
  command: boolean;
}

const COMMAND = /^\s*(please\s+|can you\s+|could you\s+)?(turn|switch|approve|skip|put|add|move|schedule|reschedule|delete|remove|cancel|mark|open|go|take|change|update|set|enable|disable|make it)\b/i;

function classify(text: string): Set<Intent> {
  const out = new Set<Intent>();
  for (const [intent, re] of RULES) if (re.test(text)) out.add(intent);
  return out;
}

export function routeMessage(message: string, previousUserMessage?: string | null): Route {
  const intents = classify(message);
  // An anaphoric or very short follow-up inherits the previous topic, so "how
  // many sets?" after a form question still gets the athlete's data and
  // drills, while a new question of its own ("how should I hydrate?") does not.
  const words = message.trim().split(/\s+/).length;
  if (previousUserMessage && (words <= 4 || ANAPHORA.test(message))) {
    for (const i of classify(previousUserMessage)) if (i !== 'app') intents.add(i);
  }
  // 'knowledge' fires on nearly any question word; when the message is about
  // the athlete's own data or an app action, that specific intent owns it.
  const specific = ['form', 'progress', 'plan', 'profile', 'app', 'suggestions'].some((i) => intents.has(i as Intent));
  const topical = /\b(warm ?-?up|race|pacing|start|blocks|acceleration|top speed|max velocity|periodi[sz]ation|taper|strength|plyo\w*|nutrition|hydrat\w*|sleep|mental|nerves|recruit\w*|hurdles?)\b/i.test(message);
  if (specific && !topical) intents.delete('knowledge');
  if (intents.size === 0) intents.add('knowledge');
  const needsActions = intents.has('plan') || intents.has('app') || intents.has('profile') || intents.has('suggestions');
  return { intents, needsActions, command: needsActions && COMMAND.test(message) };
}
