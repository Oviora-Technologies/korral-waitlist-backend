import { logRequestError } from '../middleware/requestLogging';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../config/database';
import {
  createSession,
  logout,
  ownerOnly,
  sessionToken,
  verifyPassword,
} from '../services/authService';

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'You have tried to sign in several times. Please wait 15 minutes before trying again.' },
});
router.post('/login', limiter, async (req, res) => {
  const parsed = z
    .object({
      email: z
        .string()
        .trim()
        .email()
        .transform((x) => x.toLowerCase()),
      password: z.string(),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return void res.status(401).json({ error: 'The email and password do not match. Please check both and try again.' });
  try {
    const user = await db
      .collection('registrations')
      .findOne({ email: parsed.data.email });
    if (
      !user ||
      typeof user.passwordHash !== 'string' ||
      !(await verifyPassword(parsed.data.password, user.passwordHash))
    ) {
      return void res.status(401).json({ error: 'The email and password do not match. Please check both and try again.' });
    }
    const token = await createSession(user._id);
    res.json({
      token,
      user: { id: user._id.toHexString(), name: user.name, email: user.email },
    });
  } catch (error) {
    logRequestError(req, res, error, 'authRoutes');
    res.status(500).json({ error: 'We could not sign you in right now. Please try again in a few minutes.' });
  }
});
router.get('/me', ownerOnly, async (_req, res) => {
  const user = await db
    .collection('registrations')
    .findOne({ _id: res.locals.userId }, { projection: { name: 1, email: 1 } });
  if (!user) return void res.status(401).json({ error: 'Please sign in again to continue.' });
  const organizations = await db
    .collection('organizations')
    .find(
      { adminUserId: res.locals.userId },
      {
        projection: { name: 1, type: 1, slug: 1, location: 1, description: 1 },
      },
    )
    .sort({ createdAt: -1 })
    .toArray();
  res.json({
    user: { id: user._id.toHexString(), name: user.name, email: user.email },
    organizations: organizations.map((o) => ({
      id: o._id.toHexString(),
      name: o.name,
      type: o.type,
      slug: o.slug,
      location: o.location,
      description: o.description,
    })),
  });
});
router.post('/logout', ownerOnly, async (req, res) => {
  await logout(sessionToken(req));
  res.json({ ok: true });
});
export default router;
