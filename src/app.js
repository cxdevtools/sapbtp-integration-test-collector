'use strict';

const Fastify = require('fastify');
const healthRoutes = require('./routes/health');
const collectRoutes = require('./routes/collect');
const runsRoutes = require('./routes/runs');
const storage = require('./storage');

function buildApp(opts = {}) {
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : true,
    ...opts.fastifyOptions,
  });

  fastify.register(healthRoutes);
  fastify.register(collectRoutes);
  fastify.register(runsRoutes);

  fastify.addHook('onReady', async () => {
    storage.startCleanupTimer();
  });

  return fastify;
}

module.exports = buildApp;
