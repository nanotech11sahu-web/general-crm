import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@leaddesk/platform';
import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const problems = validateEnv(process.env);
  if (problems.length) { for (const p of problems) console.error(`config: ${p}`); throw new Error('Refusing to start with an unsafe configuration'); }
  const app = configureApp(await NestFactory.create(AppModule));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
