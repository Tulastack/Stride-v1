/**
 * PROMPT B.2 — validation harness tests.
 *
 * Unit: error-metric math (RMSE/MAE/ICC) on synthetic known-offset data.
 * Integration: a deliberately-degraded engine output trips the 'experimental' gate.
 * Vision retention: no metric is presented as trusted unless validation supports it.
 */
import { mae, rmse, bias, icc } from '../metrics.js';
import {
  runValidation,
  metricStatus,
  buildReportMarkdown,
  ERROR_THRESHOLDS,
  type ValidationSample,
} from '../harness.js';
import { buildValidationDataset } from '../dataset.js';

describe('B.2 error-metric math (known offsets)', () => {
  it('MAE and bias of a constant +3 offset are exactly 3', () => {
    const truth = [10, 20, 30, 40];
    const pred = truth.map((t) => t + 3);
    expect(mae(pred, truth)).toBeCloseTo(3);
    expect(bias(pred, truth)).toBeCloseTo(3);
  });

  it('MAE of a zero-error predictor is 0 and ICC is 1', () => {
    const truth = [5, 9, 14, 22, 31];
    expect(mae(truth, truth)).toBe(0);
    expect(rmse(truth, truth)).toBe(0);
    expect(icc(truth, truth)).toBeCloseTo(1, 5);
  });

  it('RMSE penalizes a single large error more than MAE', () => {
    const truth = [0, 0, 0, 0];
    const pred = [0, 0, 0, 8];
    expect(rmse(pred, truth)).toBeGreaterThan(mae(pred, truth));
  });

  it('ICC drops toward 0 when predictions are uncorrelated/biased', () => {
    const truth = [1, 2, 3, 4, 5, 6];
    const pred = [6, 1, 5, 2, 4, 3]; // shuffled — no agreement
    expect(icc(pred, truth)).toBeLessThan(0.5);
  });

  it('throws on mismatched array lengths', () => {
    expect(() => mae([1, 2], [1])).toThrow();
  });
});

describe('B.2 experimental gate', () => {
  function sample(metric: string, viewpoint: 'side' | 'head-on', truth: number, predicted: number): ValidationSample {
    return {
      clipId: `${metric}-${viewpoint}-${truth}`,
      phase: 'acceleration',
      viewpoint,
      truth: { [metric]: truth },
      predicted: { [metric]: predicted },
    };
  }

  it('a deliberately-degraded metric trips the experimental gate', () => {
    const overBy = ERROR_THRESHOLDS.hip_extension + 6;
    const degraded = [
      sample('hip_extension', 'head-on', 50, 50 + overBy),
      sample('hip_extension', 'head-on', 45, 45 + overBy),
    ];
    const report = runValidation(degraded);
    expect(metricStatus(report, 'hip_extension', 'head-on')).toBe('experimental');
    expect(report.perMetricStatus.hip_extension).toBe('experimental');
    expect(report.knownWeakCases.length).toBeGreaterThan(0);
  });

  it('a within-threshold metric stays trusted', () => {
    const good = [
      sample('trunk_lean', 'side', 44, 45),
      sample('trunk_lean', 'side', 40, 41.5),
    ];
    const report = runValidation(good);
    expect(metricStatus(report, 'trunk_lean', 'side')).toBe('trusted');
  });

  it('an unmeasured (metric,viewpoint) cell is NOT trusted by default', () => {
    const report = runValidation([sample('trunk_lean', 'side', 44, 45)]);
    // hip_extension @ head-on was never measured -> must not be trusted
    expect(metricStatus(report, 'hip_extension', 'head-on')).toBe('experimental');
  });
});

describe('B.2 full dataset run', () => {
  const report = runValidation(buildValidationDataset());

  it('produces cells across phases and viewpoints', () => {
    expect(report.cells.length).toBeGreaterThan(0);
    const viewpoints = new Set(report.cells.map((c) => c.viewpoint));
    expect(viewpoints.has('side')).toBe(true);
    expect(viewpoints.has('head-on')).toBe(true);
  });

  it('flags hip_extension at top speed / head-on as a known-weak case (matches literature)', () => {
    expect(metricStatus(report, 'hip_extension', 'head-on')).toBe('experimental');
    // side-on temporal metric should remain trusted
    expect(metricStatus(report, 'cadence_spm', 'side')).toBe('trusted');
  });

  it('renders a markdown report containing the error table and honest limits', () => {
    const md = buildReportMarkdown(report);
    expect(md).toMatch(/Validation Report/);
    expect(md).toMatch(/MAE/);
    expect(md).toMatch(/experimental/i);
    expect(md).toMatch(/TOP SPEED/);
  });
});
