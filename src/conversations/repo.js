import { randomUUID } from 'node:crypto';
import { now } from '../db.js';

export function createConversationsRepo(db) {
  const listStmt = db.prepare(`
    SELECT c.id, c.title, c.model, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
      FROM conversations c
     ORDER BY c.updated_at DESC
  `);
  const getStmt = db.prepare('SELECT * FROM conversations WHERE id = ?');
  const insertStmt = db.prepare(
    'INSERT INTO conversations (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const touchStmt = db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?');
  const messagesStmt = db.prepare(
    'SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id',
  );
  const recentStmt = db.prepare(
    'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?',
  );
  const insertMessageStmt = db.prepare(
    'INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
  );

  return {
    list() {
      return listStmt.all().map((row) => ({
        id: row.id,
        title: row.title,
        model: row.model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messageCount: row.message_count,
      }));
    },

    get(id) {
      const row = getStmt.get(id);
      if (!row) return null;
      return {
        id: row.id,
        title: row.title,
        model: row.model,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        messages: messagesStmt.all(id).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.created_at,
        })),
      };
    },

    create({ title = 'New study session', model = null } = {}) {
      const id = randomUUID();
      const timestamp = now();
      insertStmt.run(id, title.slice(0, 200), model, timestamp, timestamp);
      return this.get(id);
    },

    setModel(id, model) {
      db.prepare('UPDATE conversations SET model = ? WHERE id = ?').run(model, id);
    },

    rename(id, title) {
      const clean = String(title ?? '').trim().slice(0, 200);
      if (!clean) return null;
      db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(clean, id);
      return this.get(id);
    },

    remove(id) {
      return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
    },

    addMessage(conversationId, role, content) {
      const timestamp = now();
      const { lastInsertRowid } = insertMessageStmt.run(conversationId, role, content, timestamp);
      touchStmt.run(timestamp, conversationId);
      return { id: Number(lastInsertRowid), role, content, createdAt: timestamp };
    },

    recentMessages(id, limit = 12) {
      return recentStmt.all(id, limit).reverse();
    },
  };
}
