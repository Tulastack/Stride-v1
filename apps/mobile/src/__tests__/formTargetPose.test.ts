import { idealSpec, poseAt, projectJoint, targetCaption } from '../lib/formTargetPose';
import type { Metric } from '../types/analysis';

function metric(key: string, value: number, range: [number, number]): Metric {
  return {
    key,
    measured: { value, low: value - 2, high: value + 2, confidence: 0.9 },
    unit: '°',
    normalRange: range,
    comparableAcrossViews: true,
  };
}

describe('formTargetPose', () => {
  it('pulls an out-of-range knee drive to the middle of the ideal band', () => {
    const spec = idealSpec([metric('knee_drive', 70, [85, 100])]);
    expect(spec.kneeDriveDeg).toBeCloseTo(92.5);
    expect(spec.adjusted).toEqual(['knee_drive']);
  });

  it('leaves the model alone when every posed metric is in range', () => {
    const metrics = [metric('knee_drive', 90, [85, 100])];
    const spec = idealSpec(metrics);
    expect(spec.adjusted).toEqual([]);
    expect(spec.kneeDriveDeg).toBeCloseTo(92.5);
    expect(targetCaption(spec, metrics)).toMatch(/clean stride/i);
  });

  it('puts the swing knee forward of the hip at the top of the drive', () => {
    const spec = idealSpec([metric('knee_drive', 70, [85, 100])]);
    const frame = poseAt(0.62, spec);
    const knee = frame.find((j) => j.name === 'kneeL')!;
    const hip = frame.find((j) => j.name === 'hipL')!;
    const head = frame.find((j) => j.name === 'head')!;
    expect(knee.x).toBeGreaterThan(hip.x);
    expect(knee.y).toBeGreaterThan(hip.y - 0.05);
    expect(head.y).toBeGreaterThan(hip.y);
  });

  it('projects the head above the hip on screen', () => {
    const frame = poseAt(0.2, idealSpec([]));
    const head = projectJoint(frame.find((j) => j.name === 'head')!, 300, 220);
    const hip = projectJoint(frame.find((j) => j.name === 'hipL')!, 300, 220);
    expect(Number.isFinite(head.x)).toBe(true);
    expect(head.y).toBeLessThan(hip.y);
  });
});
