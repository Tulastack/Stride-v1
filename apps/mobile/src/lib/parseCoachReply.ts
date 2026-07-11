/** Parse coach replies into labeled sections for scannable UI cards. */

export type CoachSectionType =
  | 'focus'
  | 'form'
  | 'drill'
  | 'plan'
  | 'fuel'
  | 'mind'
  | 'tip'
  | 'metric'
  | 'body';

export interface CoachSection {
  type: CoachSectionType;
  title: string;
  body: string;
  bullets: string[];
  /** Present when type is metric — e.g. knee_drive */
  metricKey?: string;
}

const LABEL_MAP: Record<string, { type: CoachSectionType; title: string }> = {
  FOCUS: { type: 'focus', title: 'Focus' },
  FORM: { type: 'form', title: 'Form' },
  DRILL: { type: 'drill', title: 'Drill' },
  PLAN: { type: 'plan', title: 'Plan' },
  FUEL: { type: 'fuel', title: 'Fuel' },
  MIND: { type: 'mind', title: 'Mind' },
  TIP: { type: 'tip', title: 'Tip' },
  METRIC: { type: 'metric', title: 'Metric' },
};

/** Legacy emoji headers → section types (older cached replies). */
const EMOJI_MAP: Record<string, { type: CoachSectionType; title: string }> = {
  '🎯': { type: 'focus', title: 'Focus' },
  '🏃': { type: 'form', title: 'Form' },
  '💪': { type: 'drill', title: 'Drill' },
  '📅': { type: 'plan', title: 'Plan' },
  '🍎': { type: 'fuel', title: 'Fuel' },
  '🧠': { type: 'mind', title: 'Mind' },
  '⚡': { type: 'tip', title: 'Tip' },
};

const HEADER_RE = /^(FOCUS|FORM|DRILL|PLAN|FUEL|MIND|TIP|METRIC)\s*:\s*(.*)$/i;
const EMOJI_RE = /^(🎯|🏃|💪|📅|🍎|🧠|⚡)\s*(.*)$/;
const METRIC_KEYS = [
  'knee_drive', 'trunk_lean', 'hip_extension', 'knee_flexion',
  'contact_time_ms', 'cadence_spm', 'overstride', 'arm_swing', 'vertical_oscillation',
];

function stripDecor(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#{1,3}\s*/g, '')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

function splitBullets(body: string): { prose: string; bullets: string[] } {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets: string[] = [];
  const prose: string[] = [];
  for (const line of lines) {
    if (/^[•\-\*]\s+/.test(line)) bullets.push(line.replace(/^[•\-\*]\s+/, ''));
    else prose.push(line);
  }
  return { prose: prose.join('\n'), bullets };
}

function inferMetricKey(text: string): string | undefined {
  const lower = text.toLowerCase().replace(/\s+/g, '_');
  for (const k of METRIC_KEYS) {
    if (lower.includes(k) || text.toLowerCase().includes(k.replace(/_/g, ' '))) return k;
  }
  return undefined;
}

export function parseCoachReply(raw: string): CoachSection[] {
  const text = stripDecor(raw).replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return [];

  const blocks = text.split(/\n\n+/);
  const sections: CoachSection[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const first = lines[0].trim();
    let type: CoachSectionType = 'body';
    let title = '';
    let rest = block;
    let metricKey: string | undefined;

    const label = first.match(HEADER_RE);
    const emoji = first.match(EMOJI_RE);
    if (label) {
      const key = label[1].toUpperCase();
      const meta = LABEL_MAP[key];
      type = meta.type;
      title = meta.title;
      const after = label[2]?.trim() ?? '';
      rest = [after, ...lines.slice(1)].filter(Boolean).join('\n');
      if (type === 'metric') {
        metricKey = inferMetricKey(after) ?? inferMetricKey(rest);
        if (metricKey) title = metricKey.replace(/_/g, ' ');
      }
    } else if (emoji) {
      const meta = EMOJI_MAP[emoji[1]];
      type = meta.type;
      title = meta.title;
      const after = emoji[2]?.trim() ?? '';
      rest = [after, ...lines.slice(1)].filter(Boolean).join('\n');
    }

    const { prose, bullets } = splitBullets(rest);
    if (!prose && !bullets.length && type === 'body') continue;
    if (type === 'body' && !title) {
      // Keep unlabeled chunks as plain body cards.
    }
    if (type !== 'metric') {
      const inferred = inferMetricKey(prose + ' ' + bullets.join(' '));
      if (inferred && (type === 'form' || type === 'focus')) metricKey = inferred;
    }
    sections.push({ type, title, body: prose, bullets, metricKey });
  }

  // If nothing parsed into labeled sections, one body card.
  if (!sections.length) {
    const { prose, bullets } = splitBullets(text);
    sections.push({ type: 'body', title: '', body: prose, bullets });
  }
  return sections;
}

export function detectMetricForDiagram(sections: CoachSection[]): string | undefined {
  for (const s of sections) {
    if (s.metricKey) return s.metricKey;
  }
  return undefined;
}
