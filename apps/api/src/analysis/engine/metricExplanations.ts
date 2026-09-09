// Plain-language explanations for flagged metrics, what a deviation actually
// means for the athlete's running and why it costs them speed/efficiency, not
// just a restatement of the number. Falls back to a numeric sentence in
// engine.ts for any metric key not covered here.

interface ExplanationTemplate {
  low: string;
  high: string;
}

const METRIC_EXPLANATIONS: Record<string, ExplanationTemplate> = {
  trunk_lean: {
    low: "Your torso is too upright at {value}{unit}, where typical is {range}{unit}. You're not leaning forward enough to let gravity pull you along, so every stride is muscled rather than fallen into.",
    high: "You're leaning further forward than typical at {value}{unit}, where typical is {range}{unit}. That puts your weight ahead of your feet, so you brake on each landing instead of rolling through it.",
  },
  knee_drive: {
    low: "Your knee isn't driving high enough through the swing phase: {value}{unit}, where typical is {range}{unit}. That shortens your stride and leaves speed on the table.",
    high: "Your knee is driving higher than it needs to at {value}{unit}, where typical is {range}{unit}. That's vertical effort you aren't converting into forward speed.",
  },
  hip_extension: {
    low: "You're not finishing the stride behind you: {value}{unit}, where typical is {range}{unit}. Limited hip extension costs you the push you'd otherwise get at toe-off.",
    high: "Your hip is extending further back than typical at {value}{unit}, where typical is {range}{unit}. That can tip into overstriding, and it slows how fast the leg gets back to the front.",
  },
  contact_time_ms: {
    low: "Your foot spends less time on the ground than typical: {value}{unit}, where typical is {range}{unit}. Quick and elastic, which is usually a good sign.",
    high: "Your foot stays on the ground longer than typical at {value}{unit}, where typical is {range}{unit}. Every extra millisecond in contact is time spent braking instead of pushing, and it costs you speed.",
  },
  cadence_spm: {
    low: "Your stride turnover is slower than typical: {value}{unit}, where typical is {range}{unit}. Fewer, longer strides usually mean more time on the ground and more braking on each step.",
    high: "Your stride turnover is quicker than typical at {value}{unit}, where typical is {range}{unit}. Good if it comes from quick, light steps. Worth checking it isn't just short, choppy ones.",
  },
};

/** Human-readable, cause-and-effect explanation for a flagged metric. Returns
 * null if the metric key isn't covered, caller should fall back to a plain
 * numeric sentence. */
export function explainMetric(
  key: string,
  value: number,
  unit: string,
  normalRange: [number, number],
): string | null {
  const template = METRIC_EXPLANATIONS[key];
  if (!template) return null;
  const [lo, hi] = normalRange;
  const dir = value < lo ? 'low' : 'high';
  return template[dir]
    .replace('{value}', String(value))
    .replace(/\{unit\}/g, unit)
    // "80 to 110", not "80-110": this sentence is read, not scanned.
    .replace('{range}', `${lo} to ${hi}`);
}
