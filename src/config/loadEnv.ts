import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Deployment environment variables take precedence over values in local files.
// Use the same local file in every mode; NODE_ENV is set independently.
const serverRoot = resolve(__dirname, '../..');
const filename = '.env';
const primary = resolve(serverRoot, filename);

if (existsSync(primary)) {
  const result = loadDotenv({ path: primary });
  if (result.error)
    console.error(
      `[korral config] Failed to read ${filename}:`,
      result.error.message,
    );
} else {
  console.info(
    `[korral config] No ${filename} found. Using deployment environment variables.`,
  );
}

const required = ['RESEND_API_KEY', 'EMAIL_FROM'];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.warn(
    '[korral email] Resend is NOT READY. Missing: ' + missing.join(', '),
  );
} else {
  console.info(
    '[korral email] Resend configuration detected. EMAIL_FROM must use a domain verified in Resend.',
  );
}
