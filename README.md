# Study AI

Upload your notes, ask questions, and get tutored by an AI. Notes are stored and
indexed locally; conversations and settings persist between restarts. Answers come
from the [NagaAI](https://naga.ac) OpenAI-compatible API.

## Features

- **Upload notes** — PDF, DOCX, TXT, MD, CSV, HTML (and code files). Text is
  extracted, chunked, and indexed with SQLite FTS5.
- **Grounded chat** — each question retrieves the most relevant chunks and sends
  them with the conversation history, so answers cite your notes.
- **Streaming answers** — replies stream token by token with Markdown rendering
  (headings, lists, tables, code, links).
- **Everything remembered** — notes, conversations, messages, and the chosen model
  live in `data/study.db` and survive restarts.
- **Note editor** — open any note to read or correct the extracted text; edits are
  re-indexed immediately.
- **Any NagaAI model** — pick from the live catalog (345+ chat models) in the
  sidebar, or keep the default `google/gemini-2.5-flash`.

## Quick start

```bash
npm install
cp .env.example .env        # then paste your NagaAI key
npm start                   # http://localhost:12000
```

Get a key at <https://naga.ac/dashboard/api-keys>. Without `NAGA_API_KEY` the app
still runs — you can upload and edit notes, but chat returns HTTP 503.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `NAGA_API_KEY` | – | NagaAI key (required for chat) |
| `NAGA_BASE_URL` | `https://api.naga.ac/v1` | OpenAI-compatible endpoint |
| `NAGA_MODEL` | `google/gemini-2.5-flash` | Default model |
| `PORT` | `12000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite location |
| `MAX_UPLOAD_MB` | `25` | Upload size limit |

The model can also be changed at runtime from the sidebar; the choice is saved.

## How it works

```
public/            single-page UI (no build step)
src/server.js      express app + static hosting
src/notes/         extract (pdfjs, mammoth) → chunk → SQLite FTS5 index
src/conversations/ conversations + messages
src/ai/            NagaAI client (streaming) + prompt assembly
src/routes/        notes, conversations, chat (SSE), settings
```

Retrieval is BM25 over note chunks. `POST /api/chat` returns
`text/event-stream` with `meta`, `delta`, `done`, and `error` events; `meta`
carries the conversation id, title, and the notes that were used.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Status and whether the key is configured |
| `GET` | `/api/notes` | List notes and supported extensions |
| `POST` | `/api/notes` | Upload a file (multipart field `file`) |
| `GET` | `/api/notes/:id` | Note with full extracted text |
| `PATCH` | `/api/notes/:id` | Update `title` and/or `content` |
| `DELETE` | `/api/notes/:id` | Delete a note and its index |
| `GET` | `/api/conversations` | List sessions |
| `GET` | `/api/conversations/:id` | Session with messages |
| `PATCH` | `/api/conversations/:id` | Rename or change model |
| `DELETE` | `/api/conversations/:id` | Delete a session |
| `POST` | `/api/chat` | Ask a question (SSE stream) |
| `GET` | `/api/settings` | Current model and key status |
| `PUT` | `/api/settings` | Save model (validated against the catalog) |
| `GET` | `/api/settings/models` | NagaAI chat model catalog |

## Tests

```bash
npm test
```

40 tests cover chunking, PDF/DOCX extraction, the notes and conversations repos,
prompt building, Markdown rendering, and the HTTP API (including streaming chat
against a fake AI client, and that an in-flight stream is never aborted early). No network or API key is needed.
