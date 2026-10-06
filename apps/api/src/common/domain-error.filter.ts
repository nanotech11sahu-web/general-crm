import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainError } from '@leaddesk/domain';

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
      return res.status(e.getStatus()).json({ code: 'http_error', message: typeof body === 'string' ? body : body.message, details: typeof body === 'object' ? body : undefined, requestId });
    }
    this.log.error(e instanceof Error ? e.stack : String(e));
    return res.status(500).json({ code: 'internal_error', message: 'Internal server error', requestId });
  }
}
