import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@leaddesk/platform';
import { IngressModule } from './ingress.module';
import { configureIngress } from './setup';

async function bootstrap() {
  const problems = validateEnv(process.env);
  if (problems.length) { for (const p of problems) console.error(`config: ${p}`); throw new Error('Refusing to start with an unsafe configuration'); }
  // 1 MB is far above any provider payload; anything bigger is refused before it is buffered
  const app = configureIngress(await NestFactory.create(IngressModule, { rawBody: true, bodyParser: true }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3100));
}
bootstrap();
