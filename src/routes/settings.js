import express from 'express';
import { DEFAULT_MODEL, isModelId } from '../ai/client.js';
import { DEFAULT_VISION_MODEL } from '../notes/vision.js';

export function settingsRouter({ settings, ai }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({
      model: settings.get('model', process.env.NAGA_MODEL || DEFAULT_MODEL),
      visionModel: settings.get('visionModel', process.env.NAGA_VISION_MODEL || DEFAULT_VISION_MODEL),
      apiKeyConfigured: ai.configured,
      baseUrl: process.env.NAGA_BASE_URL || 'https://api.naga.ac/v1',
    });
  });

  router.put('/', async (req, res) => {
    const updates = {};
    for (const key of ['model', 'visionModel']) {
      if (req.body?.[key] === undefined) continue;
      const value = typeof req.body[key] === 'string' ? req.body[key].trim() : '';
      if (!isModelId(value)) {
        return res.status(400).json({ error: `${key} must look like "vendor/model-name".` });
      }
      if (!(await knownModel(value))) {
        return res.status(400).json({ error: `"${value}" is not in the NagaAI model catalog.` });
      }
      updates[key] = value;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Provide a model or visionModel to update.' });
    }
    for (const [key, value] of Object.entries(updates)) settings.set(key, value);
    res.json({
      model: settings.get('model', process.env.NAGA_MODEL || DEFAULT_MODEL),
      visionModel: settings.get('visionModel', process.env.NAGA_VISION_MODEL || DEFAULT_VISION_MODEL),
    });
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
