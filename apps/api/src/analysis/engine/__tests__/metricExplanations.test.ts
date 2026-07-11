import { explainMetric } from '../metricExplanations.js';

describe('explainMetric', () => {
  it('explains a low-side deviation in plain, cause-and-effect language', () => {
    const text = explainMetric('knee_drive', 59, 'deg', [80, 110]);
    expect(text).toBeTruthy();
    expect(text).not.toMatch(/^Your knee drive \(/); // not the old raw-stat template
    expect(text).toMatch(/59deg/);
    expect(text).toMatch(/80–110deg/);
  });

  it('explains a high-side deviation with the high-direction template', () => {
    const text = explainMetric('trunk_lean', 60, 'deg', [38, 50]);
    expect(text).toBeTruthy();
    expect(text).toMatch(/leaning further forward/);
  });

  it('returns null for metric keys with no plain-language template', () => {
    expect(explainMetric('some_future_metric', 10, 'x', [0, 5])).toBeNull();
  });
});
