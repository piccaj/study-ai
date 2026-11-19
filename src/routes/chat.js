import express from 'express';
import { buildMessages, titleFromQuestion } from '../ai/prompt.js';
import { DEFAULT_MODEL, isModelId } from '../ai/client.js';

export function chatRouter({ ai, conversations, notes, settings }) {
  const router = express.Router();

  router.post('/', async (req, res, next) => {
    const { conversationId, message } = req.body ?? {};
    const question = String(message ?? '').trim();
    if (!question) return res.status(400).json({ error: 'Message cannot be empty.' });
    if (question.length > 8000) return res.status(413).json({ error: 'Message is too long (max 8000 characters).' });
    if (!ai.configured) {
      return res.status(503).json({
        error: 'NAGA_API_KEY is not set. Add it to your .env file (see .env.example) and restart the server.',
      });
    }

    let conversation = conversationId ? conversations.get(conversationId) : null;
    if (conversationId && !conversation) {
      return res.status(404).json({ error: 'Conversation not found.' });
    }

    const model = resolveModel(req.body?.model, conversation, settings);
    const history = conversation ? conversations.recentMessages(conversation.id) : [];
    const noteList = notes.list();
    const excerpts = notes.search(question, 6);
    const messages = buildMessages({ question, notes: noteList, excerpts, history });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      if (!conversation) {
        conversation = conversations.create({ title: titleFromQuestion(question), model });
      } else if (conversation.model !== model) {
        conversations.setModel(conversation.id, model);
      }

      const userMessage = conversations.addMessage(conversation.id, 'user', question);
      send('meta', {
        conversationId: conversation.id,
        title: conversation.title,
        model,
        userMessage,
        sources: uniqueSources(excerpts, noteList),
      });

      const controller = new AbortController();
      req.on('close', () => controller.abort());

      let answer = '';
      for await (const delta of ai.streamChat({ model, messages, signal: controller.signal })) {
        answer += delta;
        send('delta', { text: delta });
      }

      if (!answer.trim()) answer = 'I could not produce an answer for that. Try rephrasing the question.';
      const assistantMessage = conversations.addMessage(conversation.id, 'assistant', answer);
      send('done', { message: assistantMessage });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        send('error', { error: friendlyError(error) });
        res.end();
        return;
      }
      next(error);
    }
  });

  return router;
}

function resolveModel(requested, conversation, settings) {
  if (isModelId(requested)) return requested.trim();
  if (conversation?.model) return conversation.model;
  return settings.get('model', process.env.NAGA_MODEL || DEFAULT_MODEL);
}

function uniqueSources(excerpts, noteList) {
  const titles = new Map(noteList.map((n) => [n.id, n.title]));
  const seen = new Set();
  const sources = [];
  for (const excerpt of excerpts) {
    if (seen.has(excerpt.noteId)) continue;
    seen.add(excerpt.noteId);
    sources.push({ noteId: excerpt.noteId, title: titles.get(excerpt.noteId) ?? excerpt.title });
  }
  return sources;
}

function friendlyError(error) {
  const status = error?.status;
  if (status === 401) return 'NagaAI rejected the API key (401). Check NAGA_API_KEY.';
  if (status === 402) return 'NagaAI reports insufficient credits for that model (402). Try a :free model or top up.';
  if (status === 404) return 'That model id was not found on NagaAI (404). Pick another model.';
  if (status === 429) return 'NagaAI rate limit hit (429). Wait a moment and try again.';
  return error?.message || 'The AI request failed.';
}
