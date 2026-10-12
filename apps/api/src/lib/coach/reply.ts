// Stride Coach, reply finalisation: the last check between the model and the
// athlete.
//
// The model ends every reply with "SOURCES: <evidence IDs>" (attribution in
// the style of ALCE, Gao et al., EMNLP 2023). It is stripped here and returned
// separately, so the app can show what an answer rests on and we can audit
// grounding without the athlete reading IDs. A METRIC: line naming a key that
// was not measured in this athlete's analysis is removed rather than shown,
// because the app turns it into a chart link to a reading that does not exist.

export interface FinalReply {
  text: string;
  /** Evidence the model says it used, resolved to titles; unknown IDs dropped. */
  sources: { id: string; title: string }[];
}

export function finalizeReply(
  raw: string,
  opts: { measuredKeys?: Set<string>; evidence?: Map<string, string> } = {},
): FinalReply {
  let text = raw;
  const ids = new Set<string>();
  text = text.replace(/^\s*SOURCES?:\s*(.*)$/gim, (_m, list: string) => {
    for (const id of list.split(/[,\s]+/)) {
      const clean = id.replace(/[[\]().]/g, '').trim();
      if (clean && clean.toLowerCase() !== 'none') ids.add(clean);
    }
    return '';
  });
  if (opts.measuredKeys) {
    const measured = opts.measuredKeys;
    text = text.replace(/^\s*METRIC:\s*([a-z_]+)\s*$/gim, (line, key: string) => (measured.has(key.toLowerCase()) ? line : ''));
  }
  // The format forbids em and en dashes; enforce it rather than trust it.
  text = text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\n{3,}/g, '\n\n').trim();
  const sources = [...ids]
    .filter((id) => opts.evidence?.has(id))
    .map((id) => ({ id, title: opts.evidence!.get(id)! }));
  return { text, sources };
}
