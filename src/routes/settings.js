import express from 'express';
import { DEFAULT_MODEL, isModelId } from '../ai/client.js';

export function settingsRouter({ settings, ai }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      model: settings.get('model', process.env.NAGA_MODEL || DEFAULT_MODEL),
      apiKeyConfigured: ai.configured,
      baseUrl: process.env.NAGA_BASE_URL || 'https://api.naga.ac/v1',
    });
  });

  router.put('/', async (req, res) => {
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!isModelId(model)) {
      return res.status(400).json({ error: 'model must look like "vendor/model-name".' });
    }
    if (!(await knownModel(model))) {
      return res.status(400).json({ error: `"${model}" is not in the NagaAI model catalog.` });
    }
    settings.set('model', model);
    res.json({ model: settings.get('model') });
  });

  /**
   * Catalog lookups hit the network, so they are cached briefly. When the
   * catalog is unreachable we accept the id rather than block offline use.
   */
  let cache = { at: 0, ids: null };
  async function knownModel(model) {
    if (!cache.ids || Date.now() - cache.at > 10 * 60_000) {
      try {
        cache = { at: Date.now(), ids: new Set((await ai.listChatModels()).map((m) => m.id)) };
      } catch {
        cache = { at: Date.now(), ids: null };
      }
    }
    return cache.ids ? cache.ids.has(model) : true;
  }

  router.get('/models', async (req, res, next) => {
    try {
      res.json({ models: await ai.listChatModels(), apiKeyConfigured: ai.configured });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
