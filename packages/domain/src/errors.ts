/** Domain errors carry a stable code; the API maps them to HTTP statuses. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown, public readonly status = 422) {
    super(message);
  }
}
export const notFound = (what: string) => new DomainError('not_found', `${what} not found`, undefined, 404);
