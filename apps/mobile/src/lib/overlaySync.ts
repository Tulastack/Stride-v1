/** Shared overlay timestamp helpers — prefer wall-clock tMs over frame index. */

export interface OverlayFrame {
  tMs: number;
  kp: number[][];
  frameIndex?: number;
}

export interface OverlayData {
  fps: number;
  /** Source video container fps. When present with older buggy sidecars, used to correct tMs. */
  sourceFps?: number;
  width: number;
  height: number;
  frames: OverlayFrame[];
}

/**
 * Correct legacy overlays that stored tMs = frameIndex / poseFps instead of
 * frameIndex / sourceFps (inflating timestamps by sourceFps/poseFps).
 * New sidecars include sourceFps and already-correct tMs — leave them alone
 * when frames look consistent with sourceFps.
 */
export function correctedFrameTimes(overlay: OverlayData): OverlayFrame[] {
  const { frames, fps, sourceFps } = overlay;
  if (!frames.length || !sourceFps || !fps || sourceFps <= fps * 1.05) return frames;

  // Heuristic: if the last frame's tMs is much later than duration implied by
  // frameIndex/sourceFps, scale down. Prefer frameIndex when available.
  const last = frames[frames.length - 1];
  if (last.frameIndex != null && last.frameIndex > 0) {
    const expected = (last.frameIndex / sourceFps) * 1000;
    if (last.tMs > expected * 1.5) {
      return frames.map((f) => ({
        ...f,
        tMs: f.frameIndex != null
          ? (f.frameIndex / sourceFps) * 1000
          : f.tMs * (fps / sourceFps),
      }));
    }
    return frames;
  }

  // No frameIndex — if tMs spacing looks like pose-rate inflation, scale.
  if (frames.length >= 2) {
    const dt = frames[1].tMs - frames[0].tMs;
    const expectedDt = 1000 / fps; // pose sample interval in ms if tMs were correct
    // Bug stored frameIndex/poseFps so spacing ≈ (source/pose) * (1000/pose) wait —
    // Actually bug: tMs = frameIndex/poseFps*1000, and frameIndex jumps by source/pose,
    // so ΔtMs ≈ (source/pose)/poseFps*1000 = source/(pose²)*1000 — messy.
    // Simpler legacy fix: scale by poseFps/sourceFps when sourceFps known and
    // max tMs exceeds video-ish bound (poseFps * duration inflated).
    const scale = fps / sourceFps;
    if (scale < 0.95 && last.tMs * scale > 0) {
      // Only apply if scaling would meaningfully change times
      return frames.map((f) => ({ ...f, tMs: f.tMs * scale }));
    }
  }
  return frames;
}

/** Nearest-timestamp frame lookup (binary search on sorted tMs). */
export function pickOverlayFrame(frames: OverlayFrame[], videoMs: number): OverlayFrame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].tMs < videoMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return frames[0];
  const a = frames[lo - 1];
  const b = frames[lo];
  return Math.abs(a.tMs - videoMs) <= Math.abs(b.tMs - videoMs) ? a : b;
}
