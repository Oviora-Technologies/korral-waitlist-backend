import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import waitlistRoutes from './routes/waitlistRoutes';
import organizationRoutes from './routes/organizationRoutes';
import authRoutes from './routes/authRoutes';

export const app = express();
app.disable('x-powered-by');
// CRA's local proxy supplies X-Forwarded-For. Only trust configured proxies.
app.set('trust proxy', env.trustedProxies);

// Log every completed request, including OPTIONS preflights and failed requests.
// Never log request bodies, credentials, authorization headers or query parameters.
app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  const origin = req.get('origin') || '-';
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    console[level](
      `[HTTP] ${req.method} ${req.path} status=${res.statusCode} duration=${ms.toFixed(1)}ms origin=${origin}`
    );
  });
  next();
});

const allowedOrigins = new Set([
  'https://villa-waitlist-frontend.onrender.com',
  env.clientOrigin.trim().replace(/\/$/, ''),
]);

// Respond to browser preflight requests before route handlers and rate limits.
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) {
      callback(null, true);
    } else {
      console.warn('[CORS] Blocked origin:', origin);
      callback(new Error('Origin not allowed by CORS'));
    }
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', waitlistRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/auth', authRoutes);

// Express 5 routes async errors here. Keep error details server-side only.
const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[API ERROR] ${req.method} ${req.path}:`, error);
  if (res.headersSent) return;
  const status = message === 'Origin not allowed by CORS'
    ? 403
    : (typeof error === 'object' && error !== null && 'status' in error &&
        typeof error.status === 'number' && error.status >= 400 && error.status < 600)
      ? error.status : 500;
  res.status(status).json({
    error: status === 403 ? 'Origin not allowed' : status === 500 ? 'Internal server error' : message,
  });
};
app.use(errorHandler);
