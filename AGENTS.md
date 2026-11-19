# Agent notes

Study AI: Express + `node:sqlite` backend, dependency-free frontend, NagaAI chat.

## Commands

- `npm start` — server on `PORT` (default 12000), needs `.env` for `NAGA_API_KEY`
- `npm test` — 52 tests, no network or API key required
- `node --test test/api.test.js` — single file

## Layout

- `src/db.js` — schema (notes, note_chunks, note_pages, FTS5 index, conversations, messages, settings); `migrate()` adds new `notes` columns to existing databases
- `src/notes/` — `extract.js` (pdfjs, mammoth), `render.js` (PDF page → JPEG, image uploads), `vision.js` (page descriptions), `chunk.js`, `repo.js` (BM25 search)
- `src/ai/` — `client.js` (OpenAI SDK → NagaAI, `isModelId`, `DEFAULT_MODEL`, `describeImage`), `prompt.js`
- `src/routes/` — notes, conversations, chat (SSE), settings
- `public/` — `app.js` UI, `markdown.js` renderer, no build step

## Gotchas

- Chat streams SSE; abort with `res.on('close')` and `!res.writableEnded`, never
  `req.on('close')` — the request closes as soon as the body is read and kills the
  AI stream. `test/api.test.js` guards this.
- Model ids must match `vendor/name` and exist in the live NagaAI catalog
  (`/api/settings/models`, cached 10 min). Stub AI clients in tests must return
  `fake/model` so settings PUT passes.
- The browser automation tool duplicates typed text in the model input; the UI
  rejects it by design, so verify model changes via `curl` instead.
- `DATA_DIR` defaults to `./data`; delete it to reset notes and sessions.
- Vision descriptions are appended to `notes.content` as
  `[Page N — visual description]` blocks. `appendPageDescriptions` strips existing
  blocks first, so re-running vision replaces rather than duplicates them — keep
  that invariant or `POST /api/notes/:id/vision` will grow the note each time.
- Vision failures must never fail an upload: the note is created first, then
  `applyVision` records `vision_status` (`none` / `done` / `partial` / `failed`).
  `test/vision.test.js` covers the failure and no-API-key paths.
- `@napi-rs/canvas` is a native module; `pdfjs-dist` must be imported from
  `legacy/build/pdf.mjs` with `isEvalSupported: false` to work under Node.
