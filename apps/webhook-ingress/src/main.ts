import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IngressModule } from './ingress.module';

async function bootstrap() {
  const app = await NestFactory.create(IngressModule, { rawBody: true });
  await app.listen(Number(process.env.PORT ?? 3100));
}
bootstrap();
