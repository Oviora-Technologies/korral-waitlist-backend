import { logRequestError } from '../middleware/requestLogging';
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db } from '../config/database';
import { sendOrganizationCreatedEmail } from '../services/emailService';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import {
  createCommunityOrGroup,
  getManagedOrganization,
  getManagedMembers,
} from '../services/organizationService';
import { duplicateKey } from '../services/waitlistService';
import { ownerOnly, findSession, sessionToken } from '../services/authService';

const router = Router();
const createLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'You have made several creation attempts. Please wait 15 minutes before trying again.' },
});
const creationSchema = z.object({
  type: z.enum(['community', 'group']),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(1500),
  location: z.object({
    country: z.string().trim().min(2).max(100),
    stateProvince: z.string().trim().min(2).max(100),
    address: z.string().trim().min(5).max(250),
  }),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(2)
    .max(80),
  creator: z
    .object({
      fullName: z.string().trim().min(2).max(100),
      email: z
        .string()
        .trim()
        .email()
        .transform((value) => value.toLowerCase()),
      phone: z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{7,22}$/),
      password: z.string().min(12).max(128),
    })
    .optional(),
  consent: z.literal(true),
});

router.post('/', createLimiter, async (req, res) => {
  const parsed = creationSchema.safeParse(req.body);
  if (!parsed.success)
    return void res
      .status(400)
      .json({
        error:
          'Please enter the required information and agree to receive updates.',
      });
  try {
    const token = sessionToken(req);
    const session = token ? await findSession(token) : null;
    if (!session && !parsed.data.creator)
      return void res
        .status(401)
        .json({ error: 'Please sign in or enter creator details.' });
    const organization = await createCommunityOrGroup(
      parsed.data,
      session?.userId,
      session ? token : undefined,
    );
    // Never turn a successful database write into a failed request because of email.
    let emailSent = false;
    try {
      const creator = await db.collection('registrations').findOne(
        { _id: new ObjectId(organization.userId) },
        { projection: { name: 1, email: 1 } },
      );
      if (creator?.email) {
        emailSent = await sendOrganizationCreatedEmail({
          name: creator.name,
          email: creator.email,
          type: organization.type,
          organizationName: organization.name,
          slug: organization.slug,
        });
      }
    } catch (emailError) {
      logRequestError(req, res, emailError, 'Organization notification failed after creation');
    }
    res.status(201).json({ ...organization, emailSent });
  } catch (error) {
    logRequestError(req, res, error, 'Failed to create organization');
    res.status(duplicateKey(error) ? 409 : 500).json({
      error: duplicateKey(error)
        ? 'This email address or invitation link name is already in use. If you already have an account, sign in first. Otherwise, try a different link name.'
        : 'Unable to create the community or group. Please try again.',
    });
  }
});

const managerParams = z.object({
  type: z.enum(['community', 'group']),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(2)
    .max(80),
});
router.get('/:type/:slug/details', ownerOnly, async (req, res) => {
  const p = managerParams.safeParse(req.params);
  if (!p.success)
    return void res.status(400).json({ error: 'This community or group link is not valid. Please open it from your dashboard.' });
  try {
    const details = await getManagedOrganization(
      p.data.type,
      p.data.slug,
      res.locals.userId,
    );
    if (!details)
      return void res
        .status(403)
        .json({
          error: "Only this organization's creator may view this information.",
        });
    res.json(details);
  } catch (error) {
    logRequestError(req, res, error, 'Failed to load organization');
    res.status(500).json({ error: 'We could not load this community or group. Please refresh the page in a moment.' });
  }
});

router.get('/:type/:slug/members', ownerOnly, async (req, res) => {
  const p = managerParams.safeParse(req.params);
  if (!p.success)
    return void res.status(400).json({ error: 'This community or group link is not valid. Please open it from your dashboard.' });
  try {
    const members = await getManagedMembers(
      p.data.type,
      p.data.slug,
      res.locals.userId,
    );
    if (!members)
      return void res
        .status(403)
        .json({
          error: 'Sign in with the account that created this community or group to view its members.',
        });
    res.json({ members });
  } catch (error) {
    logRequestError(req, res, error, 'Failed to load members');
    res.status(500).json({ error: 'We could not load the member list. Please refresh the page in a moment.' });
  }
});

export default router;
