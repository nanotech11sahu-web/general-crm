import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainError } from '@leaddesk/domain';
import { errorTracker } from '@leaddesk/platform';

/** Consistent error envelope: { code, message, details, requestId } (spec §16). */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');
  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const requestId = req.headers['x-request-id'];
    if (e instanceof DomainError) return res.status(e.status).json({ code: e.code, message: e.message, details: e.details, requestId });
    if (e instanceof HttpException) {
      const body: any = e.getResponse();
      const named = typeof body === 'object' && typeof body?.code === 'string' ? body.code : undefined; // e.g. totp_required
      return res.status(e.getStatus()).json({ code: named ?? 'http_error', message: typeof body === 'string' ? body : body.message, details: typeof body === 'object' ? body : undefined, requestId });
    }
    this.log.error(e instanceof Error ? e.stack : String(e));
    errorTracker().capture(e, { status: 500 }); // only genuinely unexpected failures reach here; 4xx are normal answers
    return res.status(500).json({ code: 'internal_error', message: 'Internal server error', requestId });
  }
}
