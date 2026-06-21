/**
 * PROMPT F.4 — drill library coverage.
 * Unit: every DrillRec resolves to a drill with a loadable demoAssetId; orphans fail.
 * Integration: the library covers every flaw id the fixtures can emit.
 */
import { DRILLS, drillForFlaw, resolveDemoAsset, getDrill } from '@stride/content';
import { highQualitySideResult, lowQualityHeadOnResult } from '../fixtures/analysisResult';

describe('F.4 drill library', () => {
  it('every drill has a non-empty, resolvable demoAssetId', () => {
    for (const drill of Object.values(DRILLS)) {
      expect(drill.demoAssetId.length).toBeGreaterThan(0);
      expect(resolveDemoAsset(drill.demoAssetId)).toBeDefined();
    }
  });

  it('every recommendation in the fixtures resolves to a drill (no orphans)', () => {
    for (const result of [highQualitySideResult, lowQualityHeadOnResult]) {
      for (const rec of result.recommendations) {
        const drill = getDrill(rec.drillId);
        expect(drill).toBeDefined();
        expect(resolveDemoAsset(rec.demoAssetId)).toBeDefined();
      }
    }
  });

  it('covers every flaw id the fixtures can emit', () => {
    for (const result of [highQualitySideResult, lowQualityHeadOnResult]) {
      for (const flaw of result.flaws) {
        expect(drillForFlaw(flaw.id)).toBeDefined();
      }
    }
  });

  it('pacing guardrail: a primary flaw maps to exactly one drill', () => {
    const drill = drillForFlaw('flaw-pop-up');
    expect(drill).toBeDefined();
    expect(typeof drill!.id).toBe('string');
  });
});
