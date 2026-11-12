import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Deployment environment variables take precedence over values in local files.
// Production must not fall back to development credentials or localhost URLs.
const serverRoot = resolve(__dirname, '../..');
const production = process.env.NODE_ENV === 'production';
const filename = production ? '.env.prod' : '.env';
const primary = resolve(serverRoot, filename);

if (existsSync(primary)) {
  const result = loadDotenv({ path: primary });
  if (result.error) console.error(`[VILA config] Failed to read ${filename}:`, result.error.message);
} else {
  console.info(`[VILA config] No ${filename} found. Using deployment environment variables.`);
}

const required = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS'];
const missing = required.filter(key => !process.env[key]?.trim());
if (missing.length > 0) {
  console.warn('[VILA email] SMTP is NOT READY. Missing: ' + missing.join(', '));
} else if (/^(myemail|youraddress|replace-with|myemailpassword)/i.test(process.env.EMAIL_USER || '') ||
  /^(myemailpassword|replace-with|your-smtp)/i.test(process.env.EMAIL_PASS || '')) {
  console.warn(`[VILA email] SMTP credentials look like example placeholders. Set actual SMTP credentials in ${filename}.`);
} else {
  console.info('[VILA email] SMTP configuration detected for ' + process.env.EMAIL_HOST + ':' + process.env.EMAIL_PORT + '.');
}
