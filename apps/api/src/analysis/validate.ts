// Runtime schema validators for the analysis contract.
//
// These encode the vision-retention RULES from PRD v2.2 / addendum F.1:
//   • A metric without a confidence band is invalid.
//   • A metric that is not canonical-frame (comparableAcrossViews !== true) is invalid.
//   • Every flaw's Evidence must carry 3D canonical angles + a measured band.
//   • Every DrillRec must carry a non-empty demoAssetId.
//   • Every recommendation must reference a flawId that exists in flaws[].
//   • No free-text coaching field may exist on the result (strict objects).

import { z } from 'zod';
import type { AnalysisResult } from '@stride/types';

const unit01 = z.number().min(0).max(1);

export const confidenceBandSchema = z
  .object({
    value: z.number(),
    low: z.number(),
    high: z.number(),
    confidence: unit01,
  })
  .strict()
  .superRefine((b, ctx) => {
    if (!(b.low <= b.value && b.value <= b.high)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ConfidenceBand must satisfy low <= value <= high (got low=${b.low}, value=${b.value}, high=${b.high})`,
      });
    }
  });

const normalRangeSchema = z.tuple([z.number(), z.number()]);

export const phaseSchema = z.enum(['acceleration', 'max_velocity', 'general']);
export const severitySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export const reconstructionMethodSchema = z.enum(['2d', '3d-mono', '3d-multi']);

export const evidenceSchema = z
  .object({
    frameTimestampMs: z.number().nonnegative(),
    // Canonical-frame angles are mandatory — at least one joint must be present.
    jointAngles3D: z
      .record(z.string(), z.number())
      .refine((a) => Object.keys(a).length > 0, {
        message: 'Evidence.jointAngles3D must contain at least one canonical angle',
      }),
    measured: confidenceBandSchema,
    normalRange: normalRangeSchema,
    viewpointPenalty: unit01,
  })
  .strict();

export const flawSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    phase: phaseSchema,
    severity: severitySchema,
    plainExplanation: z.string().min(1),
    evidence: evidenceSchema,
  })
  .strict();

export const drillRecSchema = z
  .object({
    flawId: z.string().min(1),
    drillId: z.string().min(1),
    drillName: z.string().min(1),
    cue: z.string().min(1),
    demoAssetId: z.string().min(1, 'DrillRec.demoAssetId must be non-empty'),
    sets: z.number().int().positive(),
    reps: z.number().int().positive(),
    rationale: z.string().min(1),
  })
  .strict();

export const metricSchema = z
  .object({
    key: z.string().min(1),
    // A metric without a band is invalid.
    measured: confidenceBandSchema,
    unit: z.string(),
    normalRange: normalRangeSchema.optional(),
    // A non-canonical metric is invalid: this must be the literal `true`.
    comparableAcrossViews: z.literal(true),
    trustStatus: z.enum(['trusted', 'experimental']).optional(),
  })
  .strict();

export const captureQualitySchema = z
  .object({
    overall: unit01,
    fps: z.number().positive(),
    motionBlur: z.enum(['low', 'med', 'high']),
    framing: z.enum(['full', 'partial']),
    perMetricUsable: z.record(z.string(), z.boolean()),
    primaryNudge: z.string().min(1).optional(),
  })
  .strict();

export const analysisResultSchema = z
  .object({
    id: z.string().min(1),
    phase: phaseSchema,
    summary: z.string().min(1),
    flaws: z.array(flawSchema),
    recommendations: z.array(drillRecSchema),
    metrics: z.array(metricSchema),
    captureQuality: captureQualitySchema,
    reconstructionMethod: reconstructionMethodSchema,
    createdAt: z.string().min(1),
    economyScore: z.number().int().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    // Vision retention: every recommendation references an existing flaw.
    const flawIds = new Set(result.flaws.map((f) => f.id));
    result.recommendations.forEach((rec, i) => {
      if (!flawIds.has(rec.flawId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recommendations', i, 'flawId'],
          message: `recommendation.flawId "${rec.flawId}" does not reference an existing flaw`,
        });
      }
    });
  });

/** Parse + validate; throws a ZodError if the result violates the contract. */
export function validateAnalysisResult(data: unknown): AnalysisResult {
  return analysisResultSchema.parse(data) as AnalysisResult;
}

/** Non-throwing variant for callers that want to branch on validity. */
export function safeValidateAnalysisResult(data: unknown) {
  return analysisResultSchema.safeParse(data);
}
