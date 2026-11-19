import express from 'express';
import multer from 'multer';
import { extractText, isSupported, SUPPORTED_EXTENSIONS, UnsupportedFileError } from '../notes/extract.js';

export function notesRouter({ notes }) {
  const router = express.Router();
  const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes } });

  router.get('/', (req, res) => {
    res.json({ notes: notes.list(), supported: SUPPORTED_EXTENSIONS });
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded (expected field "file").' });
      const { originalname, mimetype, buffer } = req.file;
      if (!isSupported(originalname)) {
        return res.status(415).json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}` });
      }

      const content = await extractText({ buffer, filename: originalname, mimetype });
      if (!content.trim()) {
        return res.status(422).json({ error: 'No readable text found in that file.' });
      }

      const note = notes.create({
        title: (req.body?.title || '').trim() || stripExtension(originalname),
        filename: originalname,
        mimetype,
        buffer,
        content,
      });
      res.status(201).json({ note });
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
