'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Use a temp data dir for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-test-'));
process.env.COLLECTOR_DATA_DIR = tmpDir;
process.env.COLLECTOR_TTL_HOURS = '999';

const buildApp = require('../src/app');

let app;

before(async () => {
  app = buildApp({ logger: false });
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET /health returns 200', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.status, 'ok');
});

test('POST /collect returns 400 without X-Message-Id', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/collect',
    payload: Buffer.from('hello'),
  });
  assert.equal(res.statusCode, 400);
});

test('POST /collect stores document and returns 202', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-001',
      'x-test-run-id': 'run-test-1',
    },
    payload: Buffer.from('hello world'),
  });
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.equal(body.messageId, 'msg-001');
  assert.equal(body.testRunId, 'run-test-1');
  assert.equal(body.sequenceNumber, 1);
});

test('Two messages with same Message ID get different sequence numbers', async () => {
  const injectOpts = {
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-002',
      'x-test-run-id': 'run-test-2',
    },
    payload: Buffer.from('first'),
  };
  const r1 = await app.inject(injectOpts);
  const r2 = await app.inject({ ...injectOpts, payload: Buffer.from('second') });
  const b1 = JSON.parse(r1.body);
  const b2 = JSON.parse(r2.body);
  assert.equal(b1.sequenceNumber, 1);
  assert.equal(b2.sequenceNumber, 2);
});

test('GET /runs/:runId/messages/:messageId/payload returns raw payload', async () => {
  // store a doc
  await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-payload',
      'x-test-run-id': 'run-payload',
    },
    payload: Buffer.from('raw payload content'),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/runs/run-payload/messages/msg-payload/payload',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'raw payload content');
});

test('GET /runs/:runId/messages/:messageId/header returns JSON headers', async () => {
  await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'application/xml',
      'x-message-id': 'msg-headers',
      'x-test-run-id': 'run-headers',
    },
    payload: Buffer.from('<xml/>'),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/runs/run-headers/messages/msg-headers/header',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body['content-type'], 'application/xml');
  assert.equal(body['x-message-id'], 'msg-headers');
});

test('GET /runs/:runId/messages lists manifest', async () => {
  await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-manifest',
      'x-test-run-id': 'run-manifest',
    },
    payload: Buffer.from('manifest test'),
  });

  const res = await app.inject({
    method: 'GET',
    url: '/runs/run-manifest/messages',
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.ok(body.messages.find(m => m.messageId === 'msg-manifest'));
});

test('DELETE /runs/:runId deletes the run', async () => {
  await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-del',
      'x-test-run-id': 'run-del',
    },
    payload: Buffer.from('to delete'),
  });

  const del = await app.inject({ method: 'DELETE', url: '/runs/run-del' });
  assert.equal(del.statusCode, 204);

  const get = await app.inject({ method: 'GET', url: '/runs/run-del/messages' });
  assert.equal(get.statusCode, 404);
});

test('DELETE /runs/:runId/messages/:messageId/release releases a message', async () => {
  await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-release',
      'x-test-run-id': 'run-release',
    },
    payload: Buffer.from('to release'),
  });

  const rel = await app.inject({
    method: 'DELETE',
    url: '/runs/run-release/messages/msg-release/release',
  });
  assert.equal(rel.statusCode, 204);

  const get = await app.inject({
    method: 'GET',
    url: '/runs/run-release/messages/msg-release/payload',
  });
  assert.equal(get.statusCode, 404);
});

test('Missing X-Test-Run-Id uses "default" run', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-default-run',
    },
    payload: Buffer.from('default run test'),
  });
  assert.equal(res.statusCode, 202);
  const body = JSON.parse(res.body);
  assert.equal(body.testRunId, 'default');
});

test('POST /collect stores RequestPath "/" for plain /collect', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/collect',
    headers: {
      'content-type': 'text/plain',
      'x-message-id': 'msg-rpath-root',
      'x-test-run-id': 'run-rpath',
    },
    payload: Buffer.from('root path'),
  });
  assert.equal(res.statusCode, 202);
  const hdrs = await app.inject({
    method: 'GET',
    url: `/runs/run-rpath/messages/msg-rpath-root/header`,
  });
  const h = JSON.parse(hdrs.body);
  assert.equal(h['RequestPath'], '/');
});

test('POST /collect/* stores sub-path in RequestPath header', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/collect/inbound/Product',
    headers: {
      'content-type': 'application/xml',
      'x-message-id': 'msg-rpath-sub',
      'x-test-run-id': 'run-rpath-sub',
    },
    payload: Buffer.from('<product/>'),
  });
  assert.equal(res.statusCode, 202);
  const hdrs = await app.inject({
    method: 'GET',
    url: `/runs/run-rpath-sub/messages/msg-rpath-sub/header`,
  });
  const h = JSON.parse(hdrs.body);
  assert.equal(h['RequestPath'], '/inbound/Product');
});
