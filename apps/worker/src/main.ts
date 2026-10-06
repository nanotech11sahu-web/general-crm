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
import { OpsSweeper } from './ops-sweeper';
import { BillingService, RetentionService, objectStoreFromEnv, paymentProviderFromEnv } from '@leaddesk/domain';
import { instrument, startMetricsServer, workerLogger } from './observability';
import { Metrics, validateEnv } from '@leaddesk/platform';
import { KEY_SERVICE } from '@leaddesk/platform';

@Module({ imports: [DbModule] })
class WorkerModule {}

async function bootstrap() {
  const problems = validateEnv(process.env);
  if (problems.length) { for (const p of problems) console.error(`config: ${p}`); throw new Error('Refusing to start with an unsafe configuration'); }
  const metrics = new Metrics(); const log = workerLogger();
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

  // every periodic sweep: one queue, one scheduler, one instrumented worker (duration/last-success/failure metrics)
  const closers: (() => Promise<unknown>)[] = [];
  const queues: Queue[] = [];
  const periodic = async (name: string, repeat: { every: number } | { pattern: string }, run: () => Promise<unknown>) => {
    const q = new Queue(`${name}-sweep`, { connection }); queues.push(q);
    await q.upsertJobScheduler(`${name}-sweep`, repeat as any, { name: `${name}.sweep`, data: {} });
    const w = new Worker(`${name}-sweep`, instrument(metrics, log, name, run), { connection, concurrency: 1 });
    w.on('failed', (_job, err) => console.error(`${name} sweep failed`, err.message)); closers.push(() => w.close());
  };
  await periodic('do', { pattern: '* * * * *' }, () => new DoSweeper(db, sys).run());
  await periodic('sla', { every: 30_000 }, () => new SlaSweeper(db, sys).run());
  await periodic('cadence', { every: 30_000 }, () => new CadenceSweeper(db, sys, app.get(KEY_SERVICE), registry).run());
  await periodic('pulse', { pattern: '5 * * * *' }, () => new PulseSweeper(db, sys).run());
  await periodic('ai', { every: 60_000 }, () => new AiSweeper(db, sys, app.get(KEY_SERVICE), registry).run());
  await periodic('ops', { every: 300_000 }, () => new OpsSweeper(db, sys).run());
  const payments = paymentProviderFromEnv(process.env);
  await periodic('billing', { every: 60_000 }, () => BillingService.sweepAll(db, sys, payments)); // retry provider events whose first processing failed
  await periodic('billing-reminders', { pattern: '15 * * * *' }, () => BillingService.sweepAll(db, sys, payments, { reminders: true })); // trial ending / ended / payment failing, once each
  const store = objectStoreFromEnv();
  await periodic('retention', { pattern: '30 3 * * *' }, () => RetentionService.sweepAll(db, sys, store)); // nightly: recordings, soft-deleted leads, workspaces past their deletion grace period

  const events = new Queue('events', { connection });
  const dispatcher = new OutboxDispatcher(sys, {
    publish: async (e) => { await events.add(e.type, e, { jobId: e.eventId, removeOnComplete: 1000 }); },
  });
  dispatcher.start();

  // queue depth + dead-letter size as scrape-time gauges
  const watched: [string, Queue][] = [['inbox', new Queue('inbox', { connection })], ['import', new Queue('import', { connection })], ['integrity', integrityQueue], ['events', events], ...queues.map((q) => [q.name, q] as [string, Queue])];
  metrics.collect(async () => { for (const [n, q] of watched) { const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed'); for (const [state, v] of Object.entries(c)) metrics.gauge('leaddesk_queue_jobs', 'BullMQ jobs by queue and state (failed = dead-letter)', v, { queue: n, state }); } });
  metrics.collect(() => { metrics.gauge('process_uptime_seconds', 'Process uptime', process.uptime()); metrics.gauge('process_resident_memory_bytes', 'Resident memory', process.memoryUsage().rss); });
  const srv = startMetricsServer(Number(process.env.WORKER_METRICS_PORT ?? 9464), metrics, async () => (await connection.ping()) === 'PONG');

  const shutdown = async () => {
    log.info('shutting down'); srv.close(); dispatcher.stop();
    await Promise.allSettled([inboxWorker.close(), importWorker.close(), integrityWorker.close(), sweepWorker.close(), ...closers.map((c) => c())]); // let in-flight jobs finish
    await app.close(); process.exit(0);
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
bootstrap();
