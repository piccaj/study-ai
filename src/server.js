import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDatabase } from './db.js';
import { createNotesRepo } from './notes/repo.js';
import { createConversationsRepo } from './conversations/repo.js';
import { createSettingsRepo } from './settings/repo.js';
import { createAiClient } from './ai/client.js';
import { notesRouter } from './routes/notes.js';
import { conversationsRouter } from './routes/conversations.js';
import { chatRouter } from './routes/chat.js';
import { settingsRouter } from './routes/settings.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// `node src/server.js` does not read .env the way `npm start` does, and Node's
// --env-file resolves against the cwd, which panels do not always set to the app
// root. Load it from the app directory so both invocations behave the same;
// real environment variables still take precedence.
if (!process.env.NAGA_API_KEY && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(join(publicDir, '..', '.env'));
  } catch {
    // No .env is normal on hosts that inject environment variables.
  }
}

export function createApp({
  db = openDatabase(),
  ai = createAiClient(),
} = {}) {
  const notes = createNotesRepo(db);
  const conversations = createConversationsRepo(db);
  const settings = createSettingsRepo(db);

  const app = express();
  app.locals.db = db;
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, apiKeyConfigured: ai.configured });
  });

  app.use('/api/notes', notesRouter({ notes, ai, settings }));
  app.use('/api/conversations', conversationsRouter({ conversations }));
  app.use('/api/chat', chatRouter({ ai, conversations, notes, settings }));
  app.use('/api/settings', settingsRouter({ settings, ai }));

  app.use(express.static(publicDir));

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
    next();
  });

  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    const status = error.status ?? error.statusCode ?? 500;
    res.status(status).json({ error: status === 500 ? 'Something went wrong.' : error.message });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Pterodactyl-style panels expose the allocated port as SERVER_PORT.
  const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 12000);
  const app = createApp();
  app.listen(port, () => {
    console.log(`Study AI listening on http://localhost:${port}`);
    if (!process.env.NAGA_API_KEY) console.warn('NAGA_API_KEY is not set — chat will return 503 until it is.');
  });
}
