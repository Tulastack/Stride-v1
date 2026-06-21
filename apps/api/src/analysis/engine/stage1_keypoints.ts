// Stage 1 — 2D keypoints + Van Hooren-style hygiene.
// (Real ViTPose/RTMPose/MoveNet detection is the GPU/ML path; these are the
// post-processing primitives that run anywhere and are unit-tested.)

import type { Keypoint2D } from './types.js';

export const KEYPOINT_CONFIDENCE_FLOOR = 0.5;

/** Drop low-confidence samples (set to null) per the < 0.5 rule. */
export function dropLowConfidence(series: (Keypoint2D | null)[]): (Keypoint2D | null)[] {
  return series.map((k) => (k && k.confidence >= KEYPOINT_CONFIDENCE_FLOOR ? k : null));
}

/** Linear gap-fill across nulls (stand-in for cubic/pchip; deterministic). */
export function gapFill(series: (number | null)[]): number[] {
  const out = series.slice() as (number | null)[];
  const n = out.length;
  // forward/backward fill the ends
  let firstIdx = out.findIndex((v) => v !== null);
  if (firstIdx === -1) return new Array(n).fill(0);
  for (let i = 0; i < firstIdx; i++) out[i] = out[firstIdx];
  let lastIdx = n - 1;
  while (out[lastIdx] === null) lastIdx--;
  for (let i = lastIdx + 1; i < n; i++) out[i] = out[lastIdx];
  // interpolate interior gaps
  let i = firstIdx;
  while (i <= lastIdx) {
    if (out[i] === null) {
      let j = i;
      while (out[j] === null) j++;
      const a = out[i - 1] as number;
      const b = out[j] as number;
      for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
      i = j;
    } else i++;
  }
  return out as number[];
}

/** Low-pass (centered moving average) — stand-in for a ~15 Hz Butterworth. */
export function lowPass(series: number[], window = 3): number[] {
  const half = Math.floor(window / 2);
  return series.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < series.length) {
        sum += series[k];
        count++;
      }
    }
    return sum / count;
  });
}

/** Mean detector confidence across present keypoints — feeds Stage 6. */
export function meanConfidence(frame: Record<string, Keypoint2D | null | undefined>): number {
  const vals = Object.values(frame).filter((k): k is Keypoint2D => !!k).map((k) => k.confidence);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
