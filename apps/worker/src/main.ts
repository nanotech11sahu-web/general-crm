import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { createRegistry } from '@leaddesk/connectors';
import { DbModule, SYSTEM_OPS, TENANT_DB } from '@leaddesk/platform';
import { InboxProcessor } from './inbox.processor';
import { ImportProcessor } from './import.processor';
import { OutboxDispatcher } from './outbox-dispatcher';
import { IntegrityProcessor, IntegrityScheduler } from './integrity';
import { DoSweeper } from './do-sweeper';
import { SlaSweeper } from './sla-sweeper';
import { CadenceSweeper } from './cadence-sweeper';
import { PulseSweeper } from './pulse-sweeper';
import { AiSweeper } from './ai-sweeper';
import { KEY_SERVICE } from '@leaddesk/platform';

@Module({ imports: [DbModule] })
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required');
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const db = app.get(TENANT_DB);
  const sys = app.get(SYSTEM_OPS);

  const registry = createRegistry(process.env);
  const inbox = new InboxProcessor(db, registry, app.get(KEY_SERVICE));
  const inboxWorker = new Worker('inbox', (job) => inbox.process(job as any), { connection, concurrency: 10 });
  inboxWorker.on('failed', (job, err) => console.error('inbox job failed', job?.id, err.message));

  const importer = new ImportProcessor(db);
  const importWorker = new Worker('import', (job) => importer.process(job as any), { connection, concurrency: 2 });
  importWorker.on('failed', (job, err) => console.error('import job failed', job?.id, err.message));

  // --- integrity layer: sweeps fan out per-connection jobs; processors run them under tenant context ---
  const integrity = new IntegrityProcessor(db, app.get(KEY_SERVICE), registry);
  const integrityQueue = new Queue('integrity', { connection });
  const integrityWorker = new Worker('integrity', (job) => integrity.process(job as any), { connection, concurrency: 5 });
  integrityWorker.on('failed', (job, err) => console.error('integrity job failed', job?.id, err.message));
  const scheduler = new IntegrityScheduler(sys, async (j) => { await integrityQueue.add(j.name, j.data, { jobId: j.jobId, removeOnComplete: 500, removeOnFail: 500, attempts: 3, backoff: { type: 'exponential', delay: 5000 } }); });
  const sweepQueue = new Queue('integrity-sweep', { connection });
  const sweeps: [string, string, Parameters<IntegrityScheduler['sweep']>[0]][] = [
    ['heartbeat', '*/5 * * * *', 'heartbeat'], ['backfill-hourly', '7 * * * *', 'backfill_hourly'],
    ['backfill-nightly', '23 2 * * *', 'backfill_nightly'], ['backfill-weekly', '41 3 * * 0', 'backfill_weekly'],
  ];
  for (const [id, pattern] of sweeps) await sweepQueue.upsertJobScheduler(id, { pattern }, { name: id, data: {} });
  const sweepWorker = new Worker('integrity-sweep', async (job) => scheduler.sweep(sweeps.find((x) => x[0] === job.name)![2]), { connection, concurrency: 1 });
  sweepWorker.on('failed', (job, err) => console.error('sweep failed', job?.name, err.message));

  const doSweeper = new DoSweeper(db, sys);
  const doQueue = new Queue('do-sweep', { connection });
  await doQueue.upsertJobScheduler('do-sweep', { pattern: '* * * * *' }, { name: 'do.sweep', data: {} });
  const doWorker = new Worker('do-sweep', async () => doSweeper.run(), { connection, concurrency: 1 });
  doWorker.on('failed', (job, err) => console.error('do sweep failed', err.message));

  const slaSweeper = new SlaSweeper(db, sys);
  const slaQueue = new Queue('sla-sweep', { connection });
  await slaQueue.upsertJobScheduler('sla-sweep', { every: 30_000 }, { name: 'sla.sweep', data: {} });
  const slaWorker = new Worker('sla-sweep', async () => slaSweeper.run(), { connection, concurrency: 1 });
  slaWorker.on('failed', (job, err) => console.error('sla sweep failed', err.message));

  const cadenceSweeper = new CadenceSweeper(db, sys, app.get(KEY_SERVICE), registry);
  const cadenceQueue = new Queue('cadence-sweep', { connection });
  await cadenceQueue.upsertJobScheduler('cadence-sweep', { every: 30_000 }, { name: 'cadence.sweep', data: {} });
  const cadenceWorker = new Worker('cadence-sweep', async () => cadenceSweeper.run(), { connection, concurrency: 1 });
  cadenceWorker.on('failed', (job, err) => console.error('cadence sweep failed', err.message));

  const pulseSweeper = new PulseSweeper(db, sys);
  const pulseQueue = new Queue('pulse-sweep', { connection });
  await pulseQueue.upsertJobScheduler('pulse-sweep', { pattern: '5 * * * *' }, { name: 'pulse.sweep', data: {} });
  const pulseWorker = new Worker('pulse-sweep', async () => pulseSweeper.run(), { connection, concurrency: 1 });
  pulseWorker.on('failed', (job, err) => console.error('pulse sweep failed', err.message));

  const aiSweeper = new AiSweeper(db, sys, app.get(KEY_SERVICE), registry);
  const aiQueue = new Queue('ai-sweep', { connection });
  await aiQueue.upsertJobScheduler('ai-sweep', { every: 60_000 }, { name: 'ai.assess', data: {} });
  const aiWorker = new Worker('ai-sweep', async () => aiSweeper.run(), { connection, concurrency: 1 });
  aiWorker.on('failed', (job, err) => console.error('ai sweep failed', err.message));

  const events = new Queue('events', { connection });
  const dispatcher = new OutboxDispatcher(sys, {
    publish: async (e) => { await events.add(e.type, e, { jobId: e.eventId, removeOnComplete: 1000 }); },
  });
  dispatcher.start();

  const shutdown = async () => { dispatcher.stop(); await inboxWorker.close(); await importWorker.close(); await integrityWorker.close(); await sweepWorker.close(); await doWorker.close(); await slaWorker.close(); await cadenceWorker.close(); await pulseWorker.close(); await aiWorker.close(); await app.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
bootstrap();
