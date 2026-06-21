#!/usr/bin/env tsx
/**
 * scripts/validate-biomech (PROMPT B.2)
 *
 * Runs the biomechanics engine / labeled validation set, computes per-metric
 * RMSE/MAE/ICC by phase and viewpoint, gates each cell against its threshold,
 * and writes docs/validation/REPORT.md. The errors here are the documented
 * basis for the in-app confidence bands — we do not invent confidence.
 *
 * Usage: npx tsx apps/api/scripts/validate-biomech.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildValidationDataset } from '../src/analysis/validation/dataset.js';
import { runValidation, buildReportMarkdown } from '../src/analysis/validation/harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(here, '../../../docs/validation/REPORT.md');

function main(): void {
  const dataset = buildValidationDataset();
  const report = runValidation(dataset);
  const md = buildReportMarkdown(report);

  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, md, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`[validate-biomech] ${dataset.length} samples across ${report.cells.length} cells`);
  for (const [metric, status] of Object.entries(report.perMetricStatus)) {
    // eslint-disable-next-line no-console
    console.log(`  ${status === 'experimental' ? '⚠️ ' : '✅ '}${metric}: ${status}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[validate-biomech] report written -> ${REPORT_PATH}`);
}

main();
