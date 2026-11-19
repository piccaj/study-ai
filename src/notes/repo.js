import { randomUUID } from 'node:crypto';
import { now } from '../db.js';
import { chunkText } from './chunk.js';

export function createNotesRepo(db) {
  const insertNote = db.prepare(`
    INSERT INTO notes (id, title, filename, mime_type, size_bytes, content, char_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare('INSERT INTO note_chunks (note_id, idx, text) VALUES (?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO note_chunks_fts (text, chunk_id, note_id) VALUES (?, ?, ?)');
  const deleteChunks = db.prepare('DELETE FROM note_chunks WHERE note_id = ?');
  const deleteFts = db.prepare('DELETE FROM note_chunks_fts WHERE note_id = ?');
  const deleteNoteStmt = db.prepare('DELETE FROM notes WHERE id = ?');
  const getNoteStmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  const listNotesStmt = db.prepare(`
    SELECT id, title, filename, mime_type, size_bytes, char_count, created_at, updated_at
    FROM notes ORDER BY created_at DESC
  `);

  function indexChunks(noteId, content) {
    const chunks = chunkText(content);
    deleteFts.run(noteId);
    deleteChunks.run(noteId);
    chunks.forEach((text, idx) => {
      const { lastInsertRowid } = insertChunk.run(noteId, idx, text);
      insertFts.run(text, lastInsertRowid, noteId);
    });
    return chunks.length;
  }

  return {
    list() {
      return listNotesStmt.all().map(publicNote);
    },

    get(id) {
      const row = getNoteStmt.get(id);
      return row ? { ...publicNote(row), content: row.content } : null;
    },

    create({ title, filename, mimetype, buffer, content }) {
      const id = randomUUID();
      const timestamp = now();
      const cleanTitle = (title || filename).trim().slice(0, 200);
      insertNote.run(
        id,
        cleanTitle,
        filename,
        mimetype || 'application/octet-stream',
        buffer.length,
        content,
        content.length,
        timestamp,
        timestamp,
      );
      indexChunks(id, content);
      return this.get(id);
    },

    rename(id, title) {
      const cleanTitle = String(title ?? '').trim().slice(0, 200);
      if (!cleanTitle) return null;
      db.prepare('UPDATE notes SET title = ?, updated_at = ? WHERE id = ?').run(cleanTitle, now(), id);
      return this.get(id);
    },

    updateContent(id, content) {
      const existing = getNoteStmt.get(id);
      if (!existing) return null;
      db.prepare('UPDATE notes SET content = ?, char_count = ?, updated_at = ? WHERE id = ?').run(
        content,
        content.length,
        now(),
        id,
      );
      indexChunks(id, content);
      return this.get(id);
    },

    remove(id) {
      deleteFts.run(id);
      deleteChunks.run(id);
      return deleteNoteStmt.run(id).changes > 0;
    },

    /** BM25 search over note chunks. Queries with no usable tokens match nothing. */
    search(query, limit = 6) {
      const tokens = tokenizeQuery(query);
      if (!tokens.length) return [];

      const match = tokens.map((t) => `"${t}"*`).join(' OR ');
      const rows = db
        .prepare(
          `SELECT f.note_id, f.chunk_id, f.text, n.title
             FROM note_chunks_fts f
             JOIN notes n ON n.id = f.note_id
            WHERE note_chunks_fts MATCH ?
            ORDER BY bm25(note_chunks_fts)
            LIMIT ?`,
        )
        .all(match, limit);

      return rows.map((row) => ({
        noteId: row.note_id,
        chunkId: row.chunk_id,
        title: row.title,
        text: row.text,
      }));
    },
  };
}

function publicNote(row) {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    charCount: row.char_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function tokenizeQuery(query) {
  return [
    ...new Set(
      String(query ?? '')
        .toLowerCase()
        .split(/[^a-z0-9\u00c0-\u024f]+/)
        .filter((t) => t.length > 2)
        .slice(0, 12),
    ),
  ];
}
