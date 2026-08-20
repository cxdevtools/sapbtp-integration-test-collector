'use strict';

const storage = require('../storage');

async function runsRoutes(fastify) {
  // List all runs
  fastify.get('/runs', async (_request, reply) => {
    const runs = await storage.listRuns();
    return reply.send({ runs });
  });

  // Delete a run
  fastify.delete('/runs/:runId', async (request, reply) => {
    const { runId } = request.params;
    await storage.deleteRun(runId);
    return reply.code(204).send();
  });

  // Get messages manifest for a run
  fastify.get('/runs/:runId/messages', async (request, reply) => {
    const { runId } = request.params;
    try {
      const manifest = await storage.getManifest(runId);
      return reply.send({ runId, messages: Object.values(manifest.messages) });
    } catch {
      return reply.code(404).send({ error: 'Run not found' });
    }
  });

  // Get metadata for a specific message
  fastify.get('/runs/:runId/messages/:messageId', async (request, reply) => {
    const { runId, messageId } = request.params;
    try {
      const meta = await storage.getMessageMeta(runId, messageId);
      return reply.send(meta);
    } catch {
      return reply.code(404).send({ error: 'Message not found' });
    }
  });

  // Get raw payload (latest sequence)
  fastify.get('/runs/:runId/messages/:messageId/payload', async (request, reply) => {
    const { runId, messageId } = request.params;
    const seqNo = request.query.seq ? parseInt(request.query.seq, 10) : undefined;
    try {
      const payload = await storage.getPayload(runId, messageId, seqNo);
      // Try to read content-type from headers file
      let contentType = 'application/octet-stream';
      try {
        const headers = await storage.getHeaders(runId, messageId, seqNo);
        if (headers['content-type']) contentType = headers['content-type'];
      } catch {}
      return reply.type(contentType).send(payload);
    } catch {
      return reply.code(404).send({ error: 'Payload not found' });
    }
  });

  // Get headers
  fastify.get('/runs/:runId/messages/:messageId/header', async (request, reply) => {
    const { runId, messageId } = request.params;
    const seqNo = request.query.seq ? parseInt(request.query.seq, 10) : undefined;
    try {
      const headers = await storage.getHeaders(runId, messageId, seqNo);
      return reply.send(headers);
    } catch {
      return reply.code(404).send({ error: 'Headers not found' });
    }
  });

  // Release (delete) a specific message group
  fastify.delete('/runs/:runId/messages/:messageId/release', async (request, reply) => {
    const { runId, messageId } = request.params;
    try {
      await storage.releaseMessage(runId, messageId);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'Message not found' });
    }
  });

  // Get residual items for a run
  fastify.get('/runs/:runId/residual', async (request, reply) => {
    const { runId } = request.params;
    try {
      const residual = await storage.getResidual(runId);
      return reply.send({ runId, residual });
    } catch {
      return reply.code(404).send({ error: 'Run not found' });
    }
  });
}

module.exports = runsRoutes;
