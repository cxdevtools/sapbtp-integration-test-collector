'use strict';

const storage = require('../storage');

async function healthRoutes(fastify) {
  fastify.get('/health', async (request, reply) => {
    const ok = await storage.isStorageReachable();
    if (!ok) {
      return reply.code(503).send({ status: 'storage_unavailable' });
    }
    return reply.code(200).send({ status: 'ok' });
  });
}

module.exports = healthRoutes;
