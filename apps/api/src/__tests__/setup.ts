// Set required environment variables for tests.
// Preserve DATABASE_URL when CI (or the developer) has already set it.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? 'postgres://stride:stride_dev@localhost:5432/stride_test';
}
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_JWT_SECRET ??= 'test-jwt-secret-at-least-32-characters-long';
process.env.AWS_REGION ??= 'us-east-1';
process.env.AWS_ACCESS_KEY_ID ??= 'test';
process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
process.env.AWS_ENDPOINT ??= 'http://localhost:4566';
process.env.S3_BUCKET ??= 'stride-videos-test';
process.env.SQS_QUEUE_URL ??= 'http://localhost:4566/000000000000/stride-analysis-test';
process.env.INTERNAL_API_SECRET ??= 'test-internal-secret';
