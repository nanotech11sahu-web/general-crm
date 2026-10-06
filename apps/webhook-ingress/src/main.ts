import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { errorTracker, initErrorTracking, validateEnv } from '@leaddesk/platform';
import { IngressModule } from './ingress.module';
import { configureIngress } from './setup';

async function bootstrap() {
  const problems = validateEnv(process.env);
  if (problems.length) { for (const p of problems) console.error(`config: ${p}`); throw new Error('Refusing to start with an unsafe configuration'); }
  initErrorTracking('ingress'); // inert unless SENTRY_DSN is set
  process.on('unhandledRejection', (e) => { errorTracker().capture(e, { kind: 'unhandledRejection' }); console.error(e); });
  // 1 MB is far above any provider payload; anything bigger is refused before it is buffered
  const app = configureIngress(await NestFactory.create(IngressModule, { rawBody: true, bodyParser: true }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3100));
}
bootstrap();
