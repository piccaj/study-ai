import express from 'express';
import multer from 'multer';
import { extractText, isImage, isSupported, SUPPORTED_EXTENSIONS, UnsupportedFileError } from '../notes/extract.js';
import { renderPdfPages, loadImagePage } from '../notes/render.js';
import { describePages, DEFAULT_VISION_MODEL } from '../notes/vision.js';
import { isModelId } from '../ai/client.js';

export function notesRouter({ notes, ai, settings }) {
  const router = express.Router();
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });

  const visionModel = () =>
    settings?.get('visionModel') || process.env.NAGA_VISION_MODEL || DEFAULT_VISION_MODEL;

  /** Whether this upload should be looked at by a vision model. */
  const wantsVision = (requested) => {
    const choice = requested ?? 'auto';
    if (choice === 'off') return false;
    return Boolean(ai?.configured);
  };

  router.get('/', (req, res) => {
    res.json({
      notes: notes.list(),
      supported: SUPPORTED_EXTENSIONS,
      vision: { model: visionModel(), available: Boolean(ai?.configured) },
    });
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected field "file").' });
      const { originalname, mimetype, buffer } = req.file;
      if (!isSupported(originalname)) {
        return res.status(415).json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}` });
      }

      const image = isImage(originalname);
      const content = await extractText({ buffer, filename: originalname, mimetype });
      if (!content.trim() && !image) {
        return res.status(422).json({ error: 'No readable text found in that file.' });
      }

      // Render pages even when vision is off, so `POST /:id/vision` can describe
      // them later once an API key is configured.
      let rendered = { pages: [], totalPages: 0, truncated: false };
      try {
        rendered = await renderPages(buffer, originalname, mimetype);
      } catch {
        if (!content.trim()) {
          return res.status(422).json({ error: 'That file could not be read as an image or PDF.' });
        }
      }
      const { pages, truncated, totalPages } = rendered;
      if (!content.trim() && !pages.length) {
        return res.status(422).json({ error: 'No readable text found in that file.' });
      }

      let note = notes.create({
        title: (req.body?.title || '').trim() || stripExtension(originalname),
        filename: originalname,
        mimetype,
        buffer,
        content,
        pageCount: pages.length,
      });
      if (pages.length) note = notes.setPages(note.id, pages);

      // Vision runs after the note exists so a slow or failing model never loses
      // the upload; the response reports whether descriptions were added.
      let visionError = null;
      const useVision = wantsVision(req.body?.vision);
      if (pages.length && useVision) {
        const model = visionModel();
        const descriptions = await describePages({ ai, model, pages });
        note = notes.applyVision(note.id, { descriptions, model });
        visionError = descriptions.find((p) => p.error)?.error ?? null;
      }

      res.status(201).json({
        note,
        vision: { attempted: pages.length > 0 && useVision, error: visionError },
        truncated,
        totalPages,
      });
    } catch (error) {
      if (error instanceof UnsupportedFileError) {
        return res.status(415).json({ error: error.message });
      }
      if (error?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File is larger than ${process.env.MAX_UPLOAD_MB ?? 25} MB.` });
      }
      next(error);
    }
  });

  /** Re-run vision on a note that was uploaded before a key was configured. */
  router.post('/:id/vision', async (req, res, next) => {
    try {
      const note = notes.get(req.params.id);
      if (!note) return res.status(404).json({ error: 'Note not found.' });
      if (!ai?.configured) {
        return res.status(503).json({ error: 'NAGA_API_KEY is not set, so page images cannot be described.' });
      }
      if (!note.pageCount) return res.status(409).json({ error: 'This note has no stored page images.' });

      const pages = [];
      for (let idx = 0; idx < note.pageCount; idx += 1) {
        const page = notes.getPage(note.id, idx);
        if (page) pages.push({ idx, mime: page.mimeType, data: page.image });
      }
      const model = visionModel();
      const descriptions = await describePages({ ai, model, pages });
      const updated = notes.applyVision(note.id, { descriptions, model });
      res.json({ note: updated, error: descriptions.find((p) => p.error)?.error ?? null });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id/pages/:idx', (req, res) => {
    const page = notes.getPage(req.params.id, Number(req.params.idx));
    if (!page) return res.status(404).json({ error: 'Page not found.' });
    res.type(page.mimeType).send(page.image);
  });

  router.get('/:id', (req, res) => {
    const note = notes.get(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found.' });
    res.json({ note });
  });

  router.patch('/:id', (req, res) => {
    const { title, content } = req.body ?? {};
    if (typeof title !== 'string' && typeof content !== 'string') {
      return res.status(400).json({ error: 'Provide a title or content to update.' });
    }
    if (typeof title === 'string' && !title.trim()) {
      return res.status(400).json({ error: 'Title cannot be empty.' });
    }
    if (!notes.get(req.params.id)) return res.status(404).json({ error: 'Note not found.' });

    if (typeof content === 'string') notes.updateContent(req.params.id, content);
    const note = typeof title === 'string' ? notes.rename(req.params.id, title) : notes.get(req.params.id);
    res.json({ note });
  });

  router.delete('/:id', (req, res) => {
    const removed = notes.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Note not found.' });
    res.status(204).end();
  });

  return router;
}

function stripExtension(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || filename;
}

/** Produce page images for formats that carry visual content. */
async function renderPages(buffer, filename, mimetype) {
  if (isImage(filename)) return loadImagePage(buffer, mimetype);
  if (/\.pdf$/i.test(filename)) return renderPdfPages(buffer);
  return { pages: [], totalPages: 0, truncated: false };
}

