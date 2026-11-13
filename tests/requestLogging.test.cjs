const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/middleware/requestLogging.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exported, require, console, performance });
const { requestLogging, logRequestError, errorHandler } = exported;

test('request lifecycle, errors, and privacy', () => {
  const records = [];
  const originals = { info: console.info, warn: console.warn, error: console.error };
  for (const level of Object.keys(originals)) console[level] = text => records.push(JSON.parse(text));
  function request() {
    const req = { method: 'POST', originalUrl: '/api/join?token=secret-query', body: { password: 'secret-body' }, headers: { authorization: 'secret-header' } };
    const res = Object.assign(new EventEmitter(), {
      locals: {}, statusCode: 200, writableFinished: false, headersSent: false,
      setHeader(name, value) { this[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    });
    requestLogging(req, res, () => {});
    return { req, res };
  }
  try {
    for (const status of [200, 204, 400, 401, 404, 409, 429, 500]) {
      const { res } = request();
      res.statusCode = status;
      res.writableFinished = true;
      res.emit('finish'); res.emit('close');
      const last = records.at(-1);
      assert.equal(last.status, status);
      assert.equal(last.requestId, res['X-Request-ID']);
      assert.equal(last.level, status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info');
      assert.equal(records.filter(r => r.requestId === last.requestId && r.event === 'request.completed').length, 1);
    }
    const { req, res } = request();
    const error = Object.assign(new Error('secret-body secret-query secret-header'), { code: 11000, keyValue: { email: 'private@example.com' } });
    logRequestError(req, res, error, 'Database failed');
    errorHandler(error, req, res, () => assert.fail('unexpected next'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'Something went wrong on our side. Please try again in a few minutes.');
    assert.equal(res.body.requestId, res.locals.requestId);
    for (const status of [400, 403, 413]) {
      const { req, res } = request();
      errorHandler(Object.assign(new Error('secret-body'), { status }), req, res, () => {});
      assert.equal(res.statusCode, status);
    }
    res.headersSent = true;
    errorHandler(error, req, res, forwarded => assert.equal(forwarded, error));
    const aborted = request(); aborted.res.emit('close');
    assert.equal(records.at(-1).event, 'request.aborted');
    assert.equal(records.at(-1).status, null);
    assert.equal(new Set(records.filter(r => r.event === 'request.started').map(r => r.requestId)).size, records.filter(r => r.event === 'request.started').length);
    assert(!JSON.stringify(records).match(/secret-body|secret-query|secret-header|private@example.com/));
  } finally {
    Object.assign(console, originals);
  }
});
