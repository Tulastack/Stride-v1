import { SQSClient, SendMessageCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

const endpoint = process.env.AWS_ENDPOINT || undefined;

export const sqsClient = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  ...(endpoint && {
    endpoint,
  }),
});

const QUEUE_URL = process.env.SQS_QUEUE_URL!;

export async function enqueueAnalysis(analysisId: string, s3Key: string): Promise<void> {
  if (process.env.STORAGE_DRIVER === 'local') {
    // No SQS in local mode — the 'pending' analyses row IS the queue; the worker
    // polls the DB (FOR UPDATE SKIP LOCKED).
    console.log(`[queue] local mode: analysis ${analysisId} left pending for DB poller`);
    return;
  }
  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({
      analysisId,
      s3Key,
    }),
  });

  await sqsClient.send(command);
}

export async function checkSQSHealth(): Promise<boolean> {
  if (process.env.STORAGE_DRIVER === 'local') return true; // DB-queue, no SQS
  try {
    const command = new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ['QueueArn'],
    });
    await sqsClient.send(command);
    return true;
  } catch (error) {
    console.error('SQS Health check failed:', error);
    return false;
  }
}
