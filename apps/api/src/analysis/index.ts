// Analysis seam — public surface + dependency injection.
//
// Features depend on getAnalysisProvider(), never on a concrete provider or on
// AWS/S3/SQS. The app uses LocalAnalysisProvider in every env except a future
// `production-aws` flag (ANALYSIS_PROVIDER=production-aws).

export type {
  AnalysisProvider,
  AnalysisSubmitInput,
  AnalysisJobResult,
} from './provider.js';
export { LocalAnalysisProvider } from './local.js';
export { AwsAnalysisProvider } from './aws.js';
export {
  validateAnalysisResult,
  safeValidateAnalysisResult,
  analysisResultSchema,
} from './validate.js';
export {
  ANALYSIS_FIXTURES,
  highQualitySideFixture,
  lowQualityHeadOnFixture,
  pickFixture,
} from './fixtures.js';

import type { AnalysisProvider } from './provider.js';
import { LocalAnalysisProvider } from './local.js';
import { AwsAnalysisProvider } from './aws.js';

let cached: AnalysisProvider | undefined;

/** Returns the active AnalysisProvider, chosen by the ANALYSIS_PROVIDER flag. */
export function getAnalysisProvider(): AnalysisProvider {
  if (!cached) {
    cached =
      process.env.ANALYSIS_PROVIDER === 'production-aws'
        ? new AwsAnalysisProvider()
        : new LocalAnalysisProvider();
  }
  return cached;
}

/** Test seam: reset the cached provider (e.g. when env changes between tests). */
export function resetAnalysisProvider(): void {
  cached = undefined;
}
