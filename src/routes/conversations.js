import express from 'express';
import { isModelId } from '../ai/client.js';

export function conversationsRouter({ conversations }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ conversations: conversations.list() });
  });

  router.post('/', (req, res) => {
    const { title, model } = req.body ?? {};
    if (model != null && !isModelId(model)) {
      return res.status(400).json({ error: 'model must look like "vendor/model-name".' });
    }
    const conversation = conversations.create({ title: title || 'New study session', model: model ?? null });
    res.status(201).json({ conversation });
  });

  router.get('/:id', (req, res) => {
    const conversation = conversations.get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
    res.json({ conversation });
  });

  router.patch('/:id', (req, res) => {
    const { title, model } = req.body ?? {};
    if (!conversations.get(req.params.id)) return res.status(404).json({ error: 'Conversation not found.' });
    if (model != null && !isModelId(model)) {
      return res.status(400).json({ error: 'model must look like "vendor/model-name".' });
    }
    if (model) conversations.setModel(req.params.id, model.trim());
    if (typeof title === 'string') {
      const renamed = conversations.rename(req.params.id, title);
      if (!renamed) return res.status(400).json({ error: 'Title cannot be empty.' });
      return res.json({ conversation: renamed });
    }
    res.json({ conversation: conversations.get(req.params.id) });
  });

  router.delete('/:id', (req, res) => {
    const removed = conversations.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Conversation not found.' });
    res.status(204).end();
  });

  return router;
}
