import { logRequestError } from '../middleware/requestLogging';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { sendSignupEmail } from '../services/emailService';
import {
  findOrganization,
  registerPerson,
  duplicateKey,
} from '../services/waitlistService';

const router = Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'You have made several signup attempts. Please wait 15 minutes before trying again.' },
});
const registrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  consent: z.literal(true),
  organizationType: z.enum(['community', 'group']).optional(),
  organizationSlug: z
    .string()
    .regex(/^[a-z0-9-]{2,80}$/)
    .optional(),
});

router.get('/organization/:type/:slug', async (req, res) => {
  const { type, slug } = req.params;
  if (
    !['community', 'group'].includes(type) ||
    !/^[a-z0-9-]{2,80}$/.test(slug)
  ) {
    return void res.status(400).json({ error: 'This invitation link is not valid. Please ask the person who invited you for a new link.' });
  }
  try {
    const organization = await findOrganization(type, slug);
    if (!organization)
      return void res.status(404).json({ error: 'We could not find this invitation. Please ask the person who invited you to check the link.' });
    res.json({
      name: organization.name,
      type: organization.type,
      slug: organization.slug,
    });
  } catch (error) {
    logRequestError(req, res, error, 'waitlistRoutes');
    res.status(500).json({ error: 'We could not open this invitation right now. Please try again in a few minutes.' });
  }
});

router.post('/join', limiter, async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({ error: 'Please check your name and email address, and agree to receive updates before joining.' });
  const data = parsed.data;
  if (Boolean(data.organizationType) !== Boolean(data.organizationSlug)) {
    return void res.status(400).json({ error: 'This invitation is incomplete. Please open the full link shared with you.' });
  }
  try {
    const created = await registerPerson(data);
    if (!created)
      return void res.status(404).json({ error: 'We could not find this invitation. Please ask the person who invited you to check the link.' });
    // Registration is already saved: an email outage must not cause duplicate signups.
    const emailSent = await sendSignupEmail({
      name: data.name,
      email: data.email,
      organizationName: created.organizationName,
      organizationType: created.organizationType,
    });
    res.status(201).json({ message: 'You have joined the VILA waitlist!', emailSent });
  } catch (error) {
    logRequestError(req, res, error, 'waitlistRoutes');
    res.status(duplicateKey(error) ? 409 : 500).json({
      error: duplicateKey(error)
        ? 'You are already on the waitlist with this email address. There is no need to sign up again.'
        : 'We could not complete your signup right now. Please try again in a few minutes.',
    });
  }
});

export default router;
