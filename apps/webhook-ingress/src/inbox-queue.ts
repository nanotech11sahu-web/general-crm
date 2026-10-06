import { Logger } from '@nestjs/common';

export const INBOX_QUEUE = Symbol('INBOX_QUEUE');
export interface InboxQueue { enqueue(job: { tenantId: string; inboxId: string }): Promise<void> }

/** BullMQ producer (queue `inbox`, job `inbox.process`). Falls back to a logger when Redis is not configured. */
export async function createInboxQueue(redisUrl = process.env.REDIS_URL): Promise<InboxQueue> {
  if (!redisUrl) {
    new Logger('InboxQueue').warn('REDIS_URL not set: inbox jobs are not enqueued');
    return { async enqueue() {} };
  }
  const { Queue } = await import('bullmq');
  const { default: IORedis } = await import('ioredis');
  const queue = new Queue('inbox', { connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }) });
  return {
    async enqueue(job) {
      // jobId = inboxId makes enqueue idempotent too
      await queue.add('inbox.process', job, { jobId: job.inboxId, attempts: 8, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000 });
    },
  };
}
