import { parseAnalysisResult, isAnalysisResult } from '../lib/analysisApi';
import { lowQualityHeadOnResult } from '../fixtures/analysisResult';

describe('analysisApi', () => {
  it('parses result_json from a GET /videos/:id row', () => {
    const row = {
      id: 'a1',
      status: 'completed',
      result_json: lowQualityHeadOnResult,
    };
    const result = parseAnalysisResult(row);
    expect(result?.id).toBe(lowQualityHeadOnResult.id);
    expect(isAnalysisResult(result)).toBe(true);
  });

  it('returns null for pending rows without result_json', () => {
    expect(parseAnalysisResult({ id: 'a1', status: 'pending' })).toBeNull();
  });

  it('accepts a bare AnalysisResult', () => {
    expect(parseAnalysisResult(lowQualityHeadOnResult)).toBe(lowQualityHeadOnResult);
  });
});
