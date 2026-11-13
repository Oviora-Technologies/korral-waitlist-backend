const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('Resend payload, configuration, and failure handling', async () => {
  const calls = [];
  let outcome = { data: { id: 'email-id' }, error: null };
  const env = { RESEND_API_KEY: 'test-key', EMAIL_FROM: 'VILA <hello@example.com>', PUBLIC_APP_URL: 'https://example.com' };
  function load(file) {
    const exported = {};
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, {
      exports: exported, __dirname: path.dirname(path.resolve(file)), process: { env }, URL, AbortSignal,
      console: { info() {}, error() {} },
      require(id) {
        if (id === 'resend') return { Resend: class {
          constructor(key) { assert.equal(key, 'test-key'); }
          emails = { send: async (payload, options) => { calls.push(payload); assert(options.signal); if (outcome instanceof Error) throw outcome; return outcome; } };
        } };
        if (id === './emailTemplate') return load('src/services/emailTemplate.ts');
        return require(id);
      },
    });
    return exported;
  }
  const { sendSignupEmail, sendOrganizationCreatedEmail } = load('src/services/emailService.ts');
  assert.equal(await sendSignupEmail({ name: '<Ada>', email: 'ada@example.com' }), true);
  assert.equal(calls[0].from, env.EMAIL_FROM);
  assert.equal(calls[0].to[0], 'ada@example.com');
  assert(calls[0].html.includes('&lt;Ada&gt;'));
  assert(!calls[0].html.includes('cid:'));
  assert.equal(calls[0].attachments, undefined);
  assert(calls[0].text.includes('Hi <Ada>'));
  assert.equal(await sendOrganizationCreatedEmail({ name: 'Ada', email: 'ada@example.com', type: 'community', organizationName: 'Neighbors', slug: 'neighbors' }), true);
  assert(calls[1].html.includes('https://example.com/c/neighbors'));
  for (const failure of [{ data: null, error: { name: 'validation_error', statusCode: 403 } }, { data: null, error: null }, new Error('network failure')]) {
    outcome = failure;
    assert.equal(await sendSignupEmail({ name: 'Ada', email: 'ada@example.com' }), false);
  }
  const count = calls.length;
  delete env.RESEND_API_KEY;
  assert.equal(await sendSignupEmail({ name: 'Ada', email: 'ada@example.com' }), false);
  env.RESEND_API_KEY = 'test-key'; delete env.EMAIL_FROM;
  assert.equal(await sendSignupEmail({ name: 'Ada', email: 'ada@example.com' }), false);
  assert.equal(calls.length, count);
});
