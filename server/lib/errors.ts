export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'error',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, 'bad_request', details);
export const unauthorized = (message = 'Authentication required') =>
  new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'Forbidden') => new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');

/** An upstream provider (WAQI, EDGAR, TinyFish, ...) failed or is unavailable. */
export class UpstreamError extends HttpError {
  constructor(
    public readonly service: string,
    message: string,
    status = 502,
  ) {
    super(status, `${service}: ${message}`, 'upstream_error', { service });
    this.name = 'UpstreamError';
  }
}

/** Raised when a required API key / integration is not configured. */
export class NotConfiguredError extends HttpError {
  constructor(what: string) {
    super(503, `${what} is not configured on the server`, 'not_configured', { what });
    this.name = 'NotConfiguredError';
  }
}
