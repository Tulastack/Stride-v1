import { correctedFrameTimes, pickOverlayFrame, type OverlayData } from '../lib/overlaySync';

describe('overlaySync', () => {
  it('picks nearest frame by timestamp', () => {
    const frames = [
      { tMs: 0, kp: [] },
      { tMs: 66.7, kp: [] },
      { tMs: 133.3, kp: [] },
    ];
    expect(pickOverlayFrame(frames, 70)?.tMs).toBe(66.7);
    expect(pickOverlayFrame(frames, 120)?.tMs).toBe(133.3);
  });

  it('corrects legacy inflated tMs when sourceFps and frameIndex present', () => {
    // Bug: tMs = frameIndex / poseFps (15) instead of / sourceFps (120)
    const overlay: OverlayData = {
      fps: 15,
      sourceFps: 120,
      width: 1080,
      height: 1920,
      frames: [
        { tMs: 0, frameIndex: 0, kp: [] },
        { tMs: 533.3, frameIndex: 8, kp: [] },
        { tMs: 1066.7, frameIndex: 16, kp: [] },
      ],
    };
    const fixed = correctedFrameTimes(overlay);
    expect(fixed[1].tMs).toBeCloseTo(66.67, 0);
    expect(fixed[2].tMs).toBeCloseTo(133.33, 0);
  });
});
