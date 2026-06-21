/**
 * Unit tests for the analysis contract validators (PROMPT F.1 revised).
 *
 * Rider: schema validators reject metrics without bands and non-canonical
 * metrics; fixtures pass. Plus the vision-retention rules (evidence,
 * flawId references, demoAssetId, no free-text coaching slot).
 */
import {
  validateAnalysisResult,
  safeValidateAnalysisResult,
} from '../validate.js';
import {
  highQualitySideFixture,
  lowQualityHeadOnFixture,
} from '../fixtures.js';

const clone = <T>(x: T): any => structuredClone(x);

describe('validateAnalysisResult — fixtures pass', () => {
  it('accepts the high-quality side fixture', () => {
    expect(() => validateAnalysisResult(highQualitySideFixture)).not.toThrow();
  });

  it('accepts the low-quality head-on fixture', () => {
    expect(() => validateAnalysisResult(lowQualityHeadOnFixture)).not.toThrow();
  });
});

describe('validateAnalysisResult — confidence-band rules', () => {
  it('rejects a metric with no confidence band', () => {
    const bad = clone(highQualitySideFixture);
    delete bad.metrics[0].measured;
    expect(() => validateAnalysisResult(bad)).toThrow();
    expect(safeValidateAnalysisResult(bad).success).toBe(false);
  });

  it('rejects a confidence band where low > value (inverted band)', () => {
    const bad = clone(highQualitySideFixture);
    bad.metrics[0].measured = { value: 10, low: 20, high: 30, confidence: 0.9 };
    expect(() => validateAnalysisResult(bad)).toThrow();
  });

  it('rejects a confidence value outside 0..1', () => {
    const bad = clone(highQualitySideFixture);
    bad.metrics[0].measured.confidence = 1.4;
    expect(() => validateAnalysisResult(bad)).toThrow();
  });
});

describe('validateAnalysisResult — canonical-frame rule', () => {
  it('rejects a metric missing comparableAcrossViews', () => {
    const bad = clone(highQualitySideFixture);
    delete bad.metrics[0].comparableAcrossViews;
    expect(() => validateAnalysisResult(bad)).toThrow();
  });

  it('rejects a non-canonical metric (comparableAcrossViews=false)', () => {
    const bad = clone(highQualitySideFixture);
    bad.metrics[0].comparableAcrossViews = false;
    expect(() => validateAnalysisResult(bad)).toThrow();
  });
});

describe('validateAnalysisResult — evidence rules', () => {
  it('rejects a flaw whose evidence has no 3D joint angles', () => {
    const bad = clone(highQualitySideFixture);
    bad.flaws[0].evidence.jointAngles3D = {};
    expect(() => validateAnalysisResult(bad)).toThrow();
  });

  it('rejects a flaw whose evidence has no measured band', () => {
    const bad = clone(highQualitySideFixture);
    delete bad.flaws[0].evidence.measured;
    expect(() => validateAnalysisResult(bad)).toThrow();
  });
});

describe('validateAnalysisResult — recommendation rules', () => {
  it('rejects a recommendation whose flawId references no flaw', () => {
    const bad = clone(highQualitySideFixture);
    bad.recommendations[0].flawId = 'flaw-does-not-exist';
    expect(() => validateAnalysisResult(bad)).toThrow();
  });

  it('rejects a recommendation with an empty demoAssetId', () => {
    const bad = clone(highQualitySideFixture);
    bad.recommendations[0].demoAssetId = '';
    expect(() => validateAnalysisResult(bad)).toThrow();
  });
});

describe('validateAnalysisResult — no free-text coaching slot', () => {
  it('rejects an unknown free-text field on the result (strict object)', () => {
    const bad = clone(highQualitySideFixture);
    bad.coachingMessage = 'Hey, let me tell you about your run...';
    expect(() => validateAnalysisResult(bad)).toThrow();
  });
});
