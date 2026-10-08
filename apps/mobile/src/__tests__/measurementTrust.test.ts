import { trustedReading, sameMeasurementContext, hasMeasuredSession, sharesTrustedMeasurement } from '../lib/measurementTrust';
import { uploadOne, uploadTwo } from '../fixtures/history';

describe('Measurement trust and comparison context', () => {
  it('does not trust an unvalidated legacy angular measurement', () => {
    expect(trustedReading(uploadOne, uploadOne.metrics[0])).toBe(false);
    expect(trustedReading(uploadOne, uploadOne.metrics[2])).toBe(true);
  });
  it('respects explicit trust, confidence, capture usability, and finite values', () => {
    const metric = { ...uploadOne.metrics[0], trustStatus: 'trusted' as const };
    expect(trustedReading(uploadOne, metric)).toBe(true);
    expect(trustedReading(uploadOne, { ...metric, measured: { ...metric.measured, value: NaN } })).toBe(false);
    expect(trustedReading(uploadOne, { ...metric, measured: { ...metric.measured, confidence: 0.2 } })).toBe(false);
    expect(trustedReading({ ...uploadOne, captureQuality: { ...uploadOne.captureQuality, perMetricUsable: { knee_drive: false } } }, metric)).toBe(false);
  });
  it('hides sessions with no measurements and sessions that share no trusted reading', () => {
    const empty = { ...uploadOne, id: 'empty', metrics: [], flaws: [] };
    expect(hasMeasuredSession(empty)).toBe(false);
    expect(hasMeasuredSession(uploadOne)).toBe(true);
    const trusted = { ...uploadOne.metrics[2], trustStatus: 'trusted' as const };
    const withCadence = { ...uploadOne, metrics: [trusted] };
    const match = { ...uploadTwo, metrics: [{ ...trusted, measured: { ...trusted.measured, value: 250 } }] };
    expect(sharesTrustedMeasurement(withCadence, match)).toBe(true);
    expect(sharesTrustedMeasurement(withCadence, { ...match, phase: 'max_velocity' })).toBe(false);
    expect(sharesTrustedMeasurement(withCadence, empty)).toBe(false);
  });
  it('requires matching phase and pipeline before presenting deltas', () => {
    expect(sameMeasurementContext(uploadOne, uploadTwo)).toBe(true);
    expect(sameMeasurementContext(uploadOne, { ...uploadTwo, phase: 'max_velocity' })).toBe(false);
    expect(sameMeasurementContext(uploadOne, { ...uploadTwo, reconstructionMethod: '2d' })).toBe(false);
  });
});
