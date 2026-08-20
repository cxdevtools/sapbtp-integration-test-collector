'use strict';

const storage = require('../storage');

async function collectRoutes(fastify) {
  fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  const collectHandler = async (request, reply) => {
    const messageId = request.headers['x-message-id'];
    if (!messageId) {
      return reply.code(400).send({ error: 'Missing X-Message-Id header' });
    }

    const testRunId = request.headers['x-test-run-id'] || 'default';
    const payload = request.body || Buffer.alloc(0);

    // Derive the sub-path after /collect (e.g. /collect/inbound/Product -> /inbound/Product)
    const requestPath = request.url.replace(/^\/collect/, '').split('?')[0] || '/';

    // Collect all headers and add RequestPath
    const headers = { ...request.headers, 'RequestPath': requestPath };

    let result;
    try {
      result = await storage.storeDocument(testRunId, messageId, payload, headers);
    } catch (err) {
      request.log.error(err, 'Storage error');
      return reply.code(503).send({ error: 'Storage unavailable' });
    }

    return reply.code(202).send({
      messageId: result.messageId,
      testRunId: result.testRunId,
      sequenceNumber: result.seqNo,
      storedAt: result.storedAt,
    });
  };

  // Match both /collect and /collect/<any sub-path>
  fastify.post('/collect', collectHandler);
  fastify.post('/collect/*', collectHandler);
}

module.exports = collectRoutes;
