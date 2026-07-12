// Plain-language explanations for flagged metrics — what a deviation actually
// means for the athlete's running and why it costs them speed/efficiency, not
// just a restatement of the number. Falls back to a numeric sentence in
// engine.ts for any metric key not covered here.

interface ExplanationTemplate {
  low: string;
  high: string;
}

const METRIC_EXPLANATIONS: Record<string, ExplanationTemplate> = {
  trunk_lean: {
    low: "Your torso is too upright ({value}{unit} vs. a typical {range}{unit}) — you're not leaning forward enough to let gravity help pull you along, so every stride is muscled rather than fallen into.",
    high: "You're leaning further forward than typical ({value}{unit} vs. {range}{unit}) — that puts your weight ahead of your feet, forcing you to brake on each landing instead of rolling through it.",
  },
  knee_drive: {
    low: "Your knee isn't driving high enough in the swing phase ({value}{unit} vs. a typical {range}{unit}) — that shortens your stride length and leaves speed on the table.",
    high: "Your knee is driving higher than it needs to ({value}{unit} vs. {range}{unit}) — that's extra vertical effort that isn't converting into forward speed.",
  },
  hip_extension: {
    low: "You're not finishing the stride behind you ({value}{unit} vs. a typical {range}{unit}) — limited hip extension means you're losing the propulsive push you'd otherwise get at toe-off.",
    high: "Your hip is extending further back than typical ({value}{unit} vs. {range}{unit}) — that can tip into overstriding and slows how quickly the leg can return to the front for the next stride.",
  },
  contact_time_ms: {
    low: "Your foot spends less time on the ground than typical ({value}{unit} vs. a typical {range}{unit}) — quick and elastic, generally a good sign for running efficiency.",
    high: "Your foot is staying on the ground longer than typical ({value}{unit} vs. {range}{unit}) — every extra millisecond in contact is time spent braking rather than pushing forward, and it costs you speed.",
  },
  cadence_spm: {
    low: "Your stride turnover is slower than typical ({value}{unit} vs. a typical {range}{unit}) — fewer, longer strides usually mean more ground-contact time and more braking force with each step.",
    high: "Your stride turnover is quicker than typical ({value}{unit} vs. {range}{unit}) — good if it's coming from quick, light steps; worth checking it isn't just short, choppy strides.",
  },
};

/** Human-readable, cause-and-effect explanation for a flagged metric. Returns
 * null if the metric key isn't covered — caller should fall back to a plain
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
    .replace('{range}', `${lo}–${hi}`);
}
