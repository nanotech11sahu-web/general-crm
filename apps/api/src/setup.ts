import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { cors, csrf, httpMetrics, requestContext, securityHeaders } from '@leaddesk/platform';
import { ErrorEnvelopeFilter } from './common/domain-error.filter';
import { REFRESH_COOKIE } from './common/constants';
import { LOGGER, METRICS } from './hardening/hardening.module';


/** Everything that makes the HTTP surface safe by default; shared by the real server and the test harness. */
export function configureApp(app: INestApplication) {
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  if (process.env.TRUST_PROXY) http.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY); // behind a load balancer: real client IPs for rate limits
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const own = [process.env.PUBLIC_APP_URL, ...origins].filter(Boolean) as string[];
  app.use(requestContext(app.get(LOGGER, { strict: false })));
  app.use(httpMetrics(app.get(METRICS, { strict: false })));
  app.use(securityHeaders({ hsts: process.env.NODE_ENV === 'production' }));
  app.use((_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); }); // API responses are per-user: never cached by proxies or the browser
  app.use(cors(origins));
  app.use(csrf({ allowedOrigins: own, cookie: REFRESH_COOKIE }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_DOCS === '1') { // API shape is not secret, but production exposes it only on request
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('LeadDesk API').setVersion('1').setDescription('Bearer JWT (15 min) + httpOnly refresh cookie. Errors: { code, message, details, requestId }.').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc, { jsonDocumentUrl: 'openapi.json' });
  }
  return app;
}
