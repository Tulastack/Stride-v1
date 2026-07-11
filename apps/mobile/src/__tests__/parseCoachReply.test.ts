/**
 * Unit tests for coach reply section parsing (labeled headers + legacy emoji).
 */
import { detectMetricForDiagram, parseCoachReply } from '../lib/parseCoachReply';

describe('parseCoachReply', () => {
  it('splits labeled sections into cards', () => {
    const sections = parseCoachReply(
      'FOCUS: Fix knee drive first.\n\nFORM: Your thigh peaks around 59°.\n\nDRILL:\n• A-skips 3x8\n• High-knee switches\n\nMETRIC: knee_drive',
    );
    expect(sections.map((s) => s.type)).toEqual(['focus', 'form', 'drill', 'metric']);
    expect(sections[2].bullets).toHaveLength(2);
    expect(detectMetricForDiagram(sections)).toBe('knee_drive');
  });

  it('parses legacy emoji headers without crashing', () => {
    const sections = parseCoachReply('🎯 Main focus is trunk lean.\n\n💪 Try wall drives.');
    expect(sections[0].type).toBe('focus');
    expect(sections[1].type).toBe('drill');
  });

  it('falls back to a single body card for plain text', () => {
    const sections = parseCoachReply('Stay consistent with recovery this week.');
    expect(sections).toHaveLength(1);
    expect(sections[0].type).toBe('body');
  });
});
