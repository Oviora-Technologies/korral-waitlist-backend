import { requestLogging, errorHandler } from './middleware/requestLogging';
import express from 'express';
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
app.use(requestLogging);
app.use(helmet());
// Accept the deployed waitlist frontend even if CLIENT_ORIGIN is still set to a local URL.
// Keep the configured origin for other trusted deployments and local development.
const allowedOrigins = new Set([
  env.clientOrigin.replace(/\/$/, ''),
  'https://www.korral-app.com',
  'https://korral-app.com',
  'https://villa-waitlist-frontend.onrender.com',
]);

// Respond to browser preflight requests before route handlers and rate limits.
app.use(cors({
  exposedHeaders: ['X-Request-ID'],
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) {
      callback(null, true);
    } else {
      callback(Object.assign(new Error('Origin not allowed by CORS'), { status: 403, code: 'CORS_ORIGIN_DENIED' }));
    }
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

app.use(express.json({ limit: '16kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', waitlistRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/auth', authRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'We could not find what you were looking for. Please return to the home page and try again.', requestId: res.locals.requestId });
});
app.use(errorHandler);
