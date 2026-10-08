import { measuredJointAngle, preferredSide } from '../lib/poseInstrument';
import type { OverlayFrame } from '../lib/overlaySync';

function frame(): OverlayFrame {
  const kp = Array.from({ length: 17 }, () => [0, 0, 0]);
  kp[11] = [0, 0.5, 0.9];
  kp[13] = [0.5, 0.5, 0.9];
  kp[15] = [0.5, 1, 0.9];
  return { tMs: 0, kp };
}

describe('real 2D joint instruments', () => {
  it('computes an angle from captured joints', () => {
    expect(measuredJointAngle(frame(), 'knee')).toBe(90);
  });
  it('withholds a low-confidence or missing joint', () => {
    const value = frame();
    value.kp[13][2] = 0.2;
    expect(measuredJointAngle(value, 'knee')).toBeNull();
    expect(measuredJointAngle({ tMs: 0, kp: [] }, 'knee')).toBeNull();
  });
  it('does not invent an angle for coincident joints', () => {
    const value = frame();
    value.kp[11] = [...value.kp[13]];
    expect(measuredJointAngle(value, 'knee')).toBeNull();
  });
  it('corrects normalized coordinates for the actual video aspect ratio', () => {
    const value = frame();
    value.kp[11] = [0, 0, 0.9];
    value.kp[13] = [0.5, 0.5, 0.9];
    value.kp[15] = [0.5, 1, 0.9];
    expect(measuredJointAngle(value, 'knee', false, 2, 1)).toBe(153);
  });
  it('chooses a consistent side from observed confidence', () => {
    expect(preferredSide([frame()], 'knee')).toBe(false);
    const right = frame();
    for (const index of [12, 14, 16]) right.kp[index] = [0.5, 0.5, 1];
    expect(preferredSide([right], 'knee')).toBe(true);
  });
});
