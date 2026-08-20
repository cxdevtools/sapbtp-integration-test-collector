'use strict';

const fsp = require('fs/promises');
const path = require('path');

const DATA_DIR = process.env.COLLECTOR_DATA_DIR || path.join(process.cwd(), 'data');
const TTL_HOURS = parseInt(process.env.COLLECTOR_TTL_HOURS || '2', 10);
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

// Only allow safe path segment characters (no slashes, dots-only, or null bytes)
const SAFE_SEGMENT = /^[a-zA-Z0-9_\-.:@]+$/;

function validateSegment(value, name) {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    const err = new Error(`Invalid ${name}: ${JSON.stringify(value)}`);
    err.code = 'EINVAL';
    throw err;
  }
}

// In-memory mutex chains per "runId/messageId" to serialize sequence number assignment
const mutexChains = new Map();

function withMutex(key, fn) {
  const prev = mutexChains.get(key) || Promise.resolve();
  const next = prev.then(fn).catch(() => {});
  mutexChains.set(key, next);
  return prev.then(fn);
}

function runDir(testRunId) {
  validateSegment(testRunId, 'testRunId');
  const resolved = path.resolve(DATA_DIR, testRunId);
  if (!resolved.startsWith(path.resolve(DATA_DIR) + path.sep) && resolved !== path.resolve(DATA_DIR)) {
    throw Object.assign(new Error('Path traversal detected'), { code: 'EINVAL' });
  }
  return resolved;
}

function msgDir(testRunId, messageId) {
  validateSegment(messageId, 'messageId');
  const base = runDir(testRunId);
  const resolved = path.resolve(base, messageId);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw Object.assign(new Error('Path traversal detected'), { code: 'EINVAL' });
  }
  return resolved;
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function nextSequenceNumber(testRunId, messageId) {
  const dir = msgDir(testRunId, messageId);
  let entries;
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return 1;
  }
  const nums = entries
    .filter(e => e.endsWith('.payload'))
    .map(e => parseInt(e.replace('.payload', ''), 10))
    .filter(n => !isNaN(n));
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

async function updateManifest(testRunId, messageId, seqNo, contentType, timestamp) {
  const dir = runDir(testRunId);
  await ensureDir(dir);
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = { runId: testRunId, createdAt: timestamp, messages: {} };
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(raw);
  } catch {}

  if (!manifest.messages[messageId]) {
    manifest.messages[messageId] = { messageId, sequences: [] };
  }
  manifest.messages[messageId].sequences.push({ seqNo, contentType, storedAt: timestamp });
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

async function storeDocument(testRunId, messageId, payload, headers) {
  const key = `${testRunId}/${messageId}`;
  return withMutex(key, async () => {
    const seqNo = await nextSequenceNumber(testRunId, messageId);
    const dir = msgDir(testRunId, messageId);
    await ensureDir(dir);

    const payloadPath = path.join(dir, `${seqNo}.payload`);
    const headersPath = path.join(dir, `${seqNo}.headers.json`);
    const timestamp = new Date().toISOString();
    const contentType = headers['content-type'] || 'application/octet-stream';

    await fsp.writeFile(payloadPath, payload);
    await fsp.writeFile(headersPath, JSON.stringify(headers, null, 2), 'utf8');
    await updateManifest(testRunId, messageId, seqNo, contentType, timestamp);

    return { testRunId, messageId, seqNo, storedAt: timestamp };
  });
}

async function getManifest(testRunId) {
  const manifestPath = path.join(runDir(testRunId), 'manifest.json');
  const raw = await fsp.readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

async function getMessageMeta(testRunId, messageId) {
  const manifest = await getManifest(testRunId);
  const entry = manifest.messages[messageId];
  if (!entry) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
  return entry;
}

async function getPayload(testRunId, messageId, seqNo) {
  const dir = msgDir(testRunId, messageId);
  const seqNum = seqNo || await latestSeq(testRunId, messageId);
  return fsp.readFile(path.join(dir, `${seqNum}.payload`));
}

async function getHeaders(testRunId, messageId, seqNo) {
  const dir = msgDir(testRunId, messageId);
  const seqNum = seqNo || await latestSeq(testRunId, messageId);
  const raw = await fsp.readFile(path.join(dir, `${seqNum}.headers.json`), 'utf8');
  return JSON.parse(raw);
}

async function latestSeq(testRunId, messageId) {
  const meta = await getMessageMeta(testRunId, messageId);
  return meta.sequences[meta.sequences.length - 1].seqNo;
}

async function releaseMessage(testRunId, messageId) {
  const dir = msgDir(testRunId, messageId);
  await fsp.rm(dir, { recursive: true, force: true });
  // Update manifest
  const manifestPath = path.join(runDir(testRunId), 'manifest.json');
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    delete manifest.messages[messageId];
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch {}
}

async function deleteRun(testRunId) {
  await fsp.rm(runDir(testRunId), { recursive: true, force: true });
  // Clean up all mutex chains for this run
  for (const key of mutexChains.keys()) {
    if (key.startsWith(`${testRunId}/`)) mutexChains.delete(key);
  }
}

async function listRuns() {
  await ensureDir(DATA_DIR);
  const entries = await fsp.readdir(DATA_DIR, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

async function getResidual(testRunId) {
  const manifest = await getManifest(testRunId);
  return Object.values(manifest.messages);
}

async function isStorageReachable() {
  try {
    await ensureDir(DATA_DIR);
    const probe = path.join(DATA_DIR, '.health');
    await fsp.writeFile(probe, 'ok');
    await fsp.unlink(probe);
    return true;
  } catch {
    return false;
  }
}

// TTL cleanup
async function runTtlCleanup() {
  try {
    await ensureDir(DATA_DIR);
    const runs = await fsp.readdir(DATA_DIR, { withFileTypes: true });
    const now = Date.now();
    const ttlMs = TTL_HOURS * 60 * 60 * 1000;

    for (const run of runs) {
      if (!run.isDirectory()) continue;
      const manifestPath = path.join(DATA_DIR, run.name, 'manifest.json');
      try {
        const raw = await fsp.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        const created = new Date(manifest.createdAt).getTime();
        if (now - created > ttlMs) {
          await fsp.rm(path.join(DATA_DIR, run.name), { recursive: true, force: true });
        }
      } catch {}
    }
  } catch {}
}

function startCleanupTimer() {
  return setInterval(runTtlCleanup, CLEANUP_INTERVAL_MS);
}

module.exports = {
  storeDocument,
  getManifest,
  getMessageMeta,
  getPayload,
  getHeaders,
  releaseMessage,
  deleteRun,
  listRuns,
  getResidual,
  isStorageReachable,
  startCleanupTimer,
  DATA_DIR,
};
