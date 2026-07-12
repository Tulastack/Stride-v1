/**
 * Unit tests for the cosine-similarity/threshold decision logic in
 * calendarRelevance.ts. The embedding model itself (@xenova/transformers /
 * onnxruntime-node) is mocked here — under this repo's Jest ESM VM-modules
 * config, the real ONNX runtime throws a cross-realm "Float32Array" identity
 * error, so it can't run inside Jest. The real model's behavior (the actual
 * 0.55 threshold, calibrated against Xenova/all-MiniLM-L6-v2) was verified
 * manually with `tsx` outside Jest — see the threshold comment in
 * calendarRelevance.ts for the measured scores.
 *
 * No network: the transformers pipeline is mocked, never actually loaded.
 */
import { jest } from '@jest/globals';

const embedMock = jest.fn(async (text: string) => {
  if (text === 'THROW') throw new Error('model failed to load');
  if (text === 'RELEVANT') return { data: new Float32Array([1, 0]) };
  if (text === 'IRRELEVANT') return { data: new Float32Array([0, 1]) };
  // Any other text (the fixed plan exemplars) embeds as the "plan" vector.
  return { data: new Float32Array([1, 0]) };
});

jest.unstable_mockModule('@xenova/transformers', () => ({
  pipeline: jest.fn(async () => embedMock),
}));

const { isCalendarRelevant } = await import('../calendarRelevance.js');

describe('isCalendarRelevant', () => {
  it('returns true when the reply embeds close to the plan exemplars', async () => {
    expect(await isCalendarRelevant('RELEVANT')).toBe(true);
  });

  it('returns false when the reply embeds far from the plan exemplars', async () => {
    expect(await isCalendarRelevant('IRRELEVANT')).toBe(false);
  });

  it('fails closed (no CTA) instead of throwing if the model errors', async () => {
    await expect(isCalendarRelevant('THROW')).resolves.toBe(false);
  });

  it('returns false for empty text without invoking the model', async () => {
    embedMock.mockClear();
    expect(await isCalendarRelevant('')).toBe(false);
    expect(await isCalendarRelevant('   ')).toBe(false);
    expect(embedMock).not.toHaveBeenCalled();
  });
});
