import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ErrorEnvelopeFilter } from './common/domain-error.filter';

export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  return app;
}
