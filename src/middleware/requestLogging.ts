import { randomUUID } from 'node:crypto';
import type { Request, Response, RequestHandler, ErrorRequestHandler } from 'express';

function requestOrigin(req: Request): string | undefined {
  const value = req.headers.origin;
  if (!value) return undefined;
  if (value === 'null') return 'null';
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '[invalid origin]';
  } catch {
    return '[invalid origin]';
  }
}

function write(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) {
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, ...fields }));
}

export const requestLogging: RequestHandler = (req, res, next) => {
  const requestId = randomUUID();
  const started = performance.now();
  const path = req.originalUrl.split('?')[0];
  res.locals.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  write('info', { event: 'request.started', requestId, method: req.method, path, origin: requestOrigin(req) });
  let logged = false;
  const complete = () => {
    if (logged) return;
    logged = true;
    const aborted = !res.writableFinished;
    const status = aborted ? null : res.statusCode;
    write(aborted || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', {
      event: aborted ? 'request.aborted' : 'request.completed', requestId,
      method: req.method, path, status,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    });
  };
  res.once('finish', complete);
  res.once('close', complete);
  next();
};

export function logRequestError(req: Request, res: Response, error: unknown, context: string) {
  const failure = error instanceof Error ? error : undefined;
  const code = (failure as Error & { code?: unknown })?.code;
  // Raw error messages can contain MongoDB key values, credentials, or JSON bodies.
  // Keep the error class, safe code, and stack locations, never serialize the error object.
  write('error', {
    event: 'request.error', requestId: res.locals.requestId,
    method: req.method, path: req.originalUrl.split('?')[0], origin: requestOrigin(req), context,
    errorName: failure?.name || 'UnknownError',
    code: typeof code === 'number' || (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)) ? code : undefined,
    stack: failure?.stack?.split('\n').filter(line => /^\s+at /.test(line)).join('\n'),
  });
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  logRequestError(req, res, error, 'Unhandled request error');
  if (res.headersSent) {
    next(error);
    return;
  }
  const candidate = error?.status ?? error?.statusCode;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  const messages: Record<number, string> = {
    400: 'We could not read the information you sent. Please refresh the page and try again.',
    401: 'Please sign in again to continue.',
    403: 'You do not have access to this action. Please sign in with the correct account.',
    404: 'We could not find what you were looking for. Please return to the home page and try again.',
    409: 'This information conflicts with something already saved. Please review your details before trying again.',
    413: 'There is too much information to send at once. Please shorten your entry and try again.',
    429: 'You have made several attempts in a short time. Please wait a few minutes before trying again.',
  };
  const message = error?.code === 'CORS_ORIGIN_DENIED'
    ? 'We could not connect your request, Please contact the site administrator if you believe this is an error to help resolve the issue.'
    : messages[status] || 'Something went wrong on our side. Please try again in a few minutes.';
  res.status(status).json({ error: message, requestId: res.locals.requestId });
};
