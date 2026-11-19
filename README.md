# Study AI

Upload your notes, ask questions, and get tutored by an AI. Notes are stored and
indexed locally; conversations and settings persist between restarts. Answers come
from the [NagaAI](https://naga.ac) OpenAI-compatible API.

## Features

- **Upload notes** — PDF, DOCX, TXT, MD, CSV, HTML, plus images (PNG, JPG, WEBP).
  Text is extracted, chunked, and indexed with SQLite FTS5.
- **Diagrams and figures are read, not just text** — every PDF page and every
  uploaded image is rasterised and described by a vision model, so charts,
  tables, equations and annotated figures become searchable text too.
- **Grounded chat** — each question retrieves the most relevant chunks and sends
  them with the conversation history, so answers cite your notes.
- **Streaming answers** — replies stream token by token with Markdown rendering
  (headings, lists, tables, code, links).
- **Everything remembered** — notes, conversations, messages, and the chosen model
  live in `data/study.db` and survive restarts.
- **Note editor** — open any note to read or correct the extracted text; edits are
  re-indexed immediately.
- **Any NagaAI model** — pick from the live catalog (700+ chat models) in the
  sidebar, or keep the default `google/gemini-3.8-flash`.
- **Page previews** — open a note to see the rendered page images next to the
  text that was extracted from them.

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
| `NAGA_MODEL` | `google/gemini-3.8-flash` | Default chat model |
| `NAGA_VISION_MODEL` | `google/gemini-3.8-flash` | Model that describes page images |
| `PORT` | `12000` | HTTP port |
| `DATA_DIR` | `./data` | SQLite location |
| `MAX_UPLOAD_MB` | `25` | Upload size limit |
| `MAX_PDF_PAGES` | `20` | Pages rendered and described per PDF |

Both models can be changed at runtime — the chat model from the sidebar, the
vision model via `PUT /api/settings { "visionModel": "..." }`. Choices are saved
in the database.

### Choosing a model

The default is `google/gemini-3.8-flash`, which NagaAI describes as "Google's
most intelligent Flash model", with 1M-token context and text, image and PDF
input. A typical study answer costs well under a cent.

NagaAI publishes no benchmark scores, so these are lineage and price tiers
rather than measured rankings:

| Model | $/1M in | $/1M out | Notes |
| --- | --- | --- | --- |
| `google/gemini-2.5-flash` | 0.075 | 0.625 | What the free Gemini web app runs; cheapest sane baseline |
| `google/gemini-2.5-flash-lite` | 0.025 | 0.10 | Cheapest capable model; noticeably weaker at diagrams |
| **`google/gemini-3.8-flash`** | **0.188** | **0.938** | **Default** — newest Flash, best quality per dollar |
| `google/gemini-2.5-pro` | 0.312 | 2.50 | Pro-tier reasoning, generally available |
| `google/gemini-4-hydrogen` | 0.375 | 1.88 | Gemini 4 workhorse, adjustable `reasoning_effort` |
| `google/gemini-3.1-pro-preview` | 0.50 | 3.00 | Pro-tier, preview only |
| `anthropic/claude-sonnet-5.5` | 1.00 | 5.00 | Strong at careful explanation, ~5x the cost |

If you already pay for a Gemini subscription and want to replicate that quality,
`google/gemini-2.5-flash` is the closest match. For harder coursework — proofs,
multi-step physics, dense diagrams — switch to `google/gemini-2.5-pro` or
`google/gemini-4-hydrogen` from the sidebar; the choice is saved per session.

`google/gemini-2.5-flash:free` is in the catalog and matches the free Gemini you
already use, but free requests are rate limited, which stalls bulk page
description. Paid models have no such limit.

## How it works

```
public/            single-page UI (no build step)
src/server.js      express app + static hosting
src/notes/         extract (pdfjs, mammoth) → render pages → vision → chunk → FTS5
src/conversations/ conversations + messages
src/ai/            NagaAI client (streaming) + prompt assembly
src/routes/        notes, conversations, chat (SSE), settings
```

Page images are stored in SQLite and served from
`GET /api/notes/:id/pages/:idx`. Vision descriptions are appended to the note
text as `[Page N — visual description]` blocks, so they are indexed and cited
like any other text. Re-running `POST /api/notes/:id/vision` replaces those
blocks instead of duplicating them.

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
