import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { defaultRegistry } from '@leaddesk/connectors-core';
import { DbModule, SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { InboxProcessor } from './inbox.processor';
import { ImportProcessor } from './import.processor';
import { OutboxDispatcher } from './outbox-dispatcher';

@Module({ imports: [DbModule] })
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required');
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const db = app.get(TENANT_DB);
  const sys = app.get(SYSTEM_OPS);

  const inbox = new InboxProcessor(db, defaultRegistry());
  const inboxWorker = new Worker('inbox', (job) => inbox.process(job as any), { connection, concurrency: 10 });
  inboxWorker.on('failed', (job, err) => console.error('inbox job failed', job?.id, err.message));

  const importer = new ImportProcessor(db);
  const importWorker = new Worker('import', (job) => importer.process(job as any), { connection, concurrency: 2 });
  importWorker.on('failed', (job, err) => console.error('import job failed', job?.id, err.message));

  const events = new Queue('events', { connection });
  const dispatcher = new OutboxDispatcher(sys, {
    publish: async (e) => { await events.add(e.type, e, { jobId: e.eventId, removeOnComplete: 1000 }); },
  });
  dispatcher.start();

  const shutdown = async () => { dispatcher.stop(); await inboxWorker.close(); await importWorker.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
bootstrap();
