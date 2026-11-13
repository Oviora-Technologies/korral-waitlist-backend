import { Resend } from 'resend';
import { renderEmail } from './emailTemplate';

type Message = {
  to: string;
  name: string;
  subject: string;
  heading: string;
  message: string;
  actionText?: string;
  actionUrl?: string;
};

function appUrl(path: string) {
  const base =
    process.env.PUBLIC_APP_URL ||
    process.env.CLIENT_ORIGIN ||
    'http://localhost:3000';
  return new URL(path, base.endsWith('/') ? base : base + '/').toString();
}

/** Email is sent only AFTER registration succeeds. Failures must never invalidate or repeat a saved registration. */
async function send(message: Message): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    const missing = [!apiKey && 'RESEND_API_KEY', !from && 'EMAIL_FROM']
      .filter(Boolean)
      .join(', ');
    console.error(`[korral email] Not sent: missing ${missing}.`);
    return false;
  }
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send(
      {
        from,
        to: [message.to],
        subject: message.subject,
        text: `Hi ${message.name},\n\n${message.message}\n\n${message.actionText && message.actionUrl ? message.actionText + ': ' + message.actionUrl + '\n\n' : ''}Thanks,\nThe korral Team`,
        html: renderEmail(message),
      },
      { signal: AbortSignal.timeout(10000) },
    );
    if (error) {
      console.error('[korral email] Resend rejected the email:', {
        name: error.name,
        statusCode: error.statusCode,
      });
      if (error.statusCode === 401 || error.statusCode === 403) {
        console.error(
          '[korral email] Check RESEND_API_KEY permissions and verify the EMAIL_FROM domain in Resend.',
        );
      }
      return false;
    }
    if (!data?.id) {
      console.error('[korral email] Resend returned no email ID.');
      return false;
    }
    console.info('[korral email] Resend accepted the email:', { id: data.id });
    return true;
  } catch (error) {
    console.error('[korral email] Resend send failed:', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return false;
  }
}

export function sendSignupEmail({
  name,
  email,
  organizationName,
  organizationType,
}: {
  name: string;
  email: string;
  organizationName?: string;
  organizationType?: string;
}) {
  const attached = organizationName && organizationType;
  return send({
    to: email,
    name,
    subject: attached
      ? `Welcome to ${organizationName} on korral!`
      : 'Welcome to the korral waitlist!',
    heading: attached ? 'You are on the list!' : 'Welcome to korral!',
    message: attached
      ? `You have successfully joined the korral early-access waitlist through ${organizationName}. We will email you when korral is ready. `
      : 'You have successfully joined the korral early-access waitlist. We will keep you posted as we prepare to launch!',
    // actionText: 'Explore korral',
    // actionUrl: appUrl('/'),
  });
}

export function sendOrganizationCreatedEmail({
  name,
  email,
  type,
  organizationName,
  slug,
}: {
  name: string;
  email: string;
  type: 'community' | 'group';
  organizationName: string;
  slug: string;
}) {
  const invitePath = '/' + (type === 'community' ? 'c' : 'g') + '/' + slug;
  return send({
    to: email,
    name,
    subject: `Your korral ${type} "${organizationName}" is ready!`,
    heading: 'Your people have a place on korral!',
    message: `You have successfully created the ${type} "${organizationName}" on korral. You are its creator and administrator. Share the invitation link below to welcome people to your ${type}. You can sign in with your email and password to manage registrations.`,
    actionText: 'Share your invitation',
    actionUrl: appUrl(invitePath),
  });
}
