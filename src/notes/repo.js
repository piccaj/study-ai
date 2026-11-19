import { randomUUID } from 'node:crypto';
import { now } from '../db.js';
import { chunkText } from './chunk.js';
import { appendPageDescriptions } from './vision.js';

export function createNotesRepo(db) {
  const insertNote = db.prepare(`
    INSERT INTO notes (id, title, filename, mime_type, size_bytes, content, char_count, page_count,
                       vision_status, vision_model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertChunk = db.prepare('INSERT INTO note_chunks (note_id, idx, text) VALUES (?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO note_chunks_fts (text, chunk_id, note_id) VALUES (?, ?, ?)');
  const deleteChunks = db.prepare('DELETE FROM note_chunks WHERE note_id = ?');
  const deleteFts = db.prepare('DELETE FROM note_chunks_fts WHERE note_id = ?');
  const deletePages = db.prepare('DELETE FROM note_pages WHERE note_id = ?');
  const deleteNoteStmt = db.prepare('DELETE FROM notes WHERE id = ?');
  const getNoteStmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  const listNotesStmt = db.prepare(`
    SELECT id, title, filename, mime_type, size_bytes, char_count, page_count, vision_status, vision_model,
           created_at, updated_at
    FROM notes ORDER BY created_at DESC
  `);
  const insertPage = db.prepare(`
    INSERT INTO note_pages (note_id, idx, mime_type, width, height, description, image)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const listPagesStmt = db.prepare(
    'SELECT idx, mime_type, width, height, description FROM note_pages WHERE note_id = ? ORDER BY idx',
  );
  const getPageStmt = db.prepare('SELECT mime_type, image FROM note_pages WHERE note_id = ? AND idx = ?');

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
      return row ? { ...publicNote(row), content: row.content, pages: listPagesStmt.all(id).map(publicPage) } : null;
    },

    create({ title, filename, mimetype, buffer, content, pageCount = 0 }) {
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
        pageCount,
        'none',
        null,
        timestamp,
        timestamp,
      );
      indexChunks(id, content);
      return this.get(id);
    },

    /** Replace the stored page images for a note, keeping any descriptions already set. */
    setPages(id, pages) {
      deletePages.run(id);
      for (const page of pages) {
        insertPage.run(
          id,
          page.idx,
          page.mime,
          page.width ?? null,
          page.height ?? null,
          page.description ?? null,
          page.data,
        );
      }
      db.prepare('UPDATE notes SET page_count = ?, updated_at = ? WHERE id = ?').run(pages.length, now(), id);
      return this.get(id);
    },

    /** Record vision results and fold their text into the note body for search. */
    applyVision(id, { descriptions, model }) {
      const existing = getNoteStmt.get(id);
      if (!existing) return null;
      if (!descriptions.length) return this.get(id);

      const updateDescription = db.prepare('UPDATE note_pages SET description = ? WHERE note_id = ? AND idx = ?');
      for (const page of descriptions) {
        if (page.description) updateDescription.run(page.description, id, page.idx);
      }

      const succeeded = descriptions.filter((p) => p.description).length;
      const status = succeeded === 0 ? 'failed' : succeeded < descriptions.length ? 'partial' : 'done';
      const content = appendPageDescriptions(existing.content, descriptions);
      db.prepare(
        'UPDATE notes SET content = ?, char_count = ?, vision_status = ?, vision_model = ?, updated_at = ? WHERE id = ?',
      ).run(content, content.length, status, model, now(), id);
      indexChunks(id, content);
      return this.get(id);
    },

    getPage(id, idx) {
      const row = getPageStmt.get(id, idx);
      return row ? { mimeType: row.mime_type, image: row.image } : null;
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
      deletePages.run(id);
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

function publicPage(row) {
  return { idx: row.idx, mimeType: row.mime_type, width: row.width, height: row.height, description: row.description };
}

function publicNote(row) {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    charCount: row.char_count,
    pageCount: row.page_count ?? 0,
    visionStatus: row.vision_status ?? 'none',
    visionModel: row.vision_model ?? null,
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
