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

## Deploying to Render

The repo includes a `render.yaml` blueprint, so Render can create the service,
disk and environment variables in one step: **New → Blueprint**, pick the repo,
then paste your `NAGA_API_KEY` when prompted. Nothing secret is committed —
`NAGA_API_KEY` uses `sync: false`, which makes Render ask for it at deploy time.

There is no `.env` in production. Render injects environment variables
directly, and `npm start` uses `--env-file-if-exists=.env`, so the same command
works locally and on Render.

### The part that matters: your notes need a disk

SQLite stores notes, conversations and page images in a single file under
`DATA_DIR`. A Render service's filesystem is **ephemeral** — wiped on every
deploy and restart — so without a persistent disk, every note and conversation
is lost whenever you push. Two consequences:

- **Free instances cannot attach a disk at all.** The free tier is fine for
  trying the UI, but notes vanish on redeploy and the service sleeps after 15
  minutes of inactivity. Use `plan: starter` (or higher) for real use.
- `DATA_DIR` must equal the disk's `mountPath`. The blueprint sets both to
  `/var/data`. If they diverge, the app happily writes to ephemeral storage and
  you lose data without any error.

Disks bill at about $0.25/GB/month, so the 1 GB in the blueprint is a few cents.
Render also takes daily snapshots of disks automatically.

### Things to know

- **Single instance only.** SQLite does not work across multiple instances, and
  a disk can only mount to one service. Leave scaling at 1.
- **Memory.** Rendering a PDF peaks around 155 MB RSS for an 8-page deck.
  `starter` (512 MB) is enough; large decks with `MAX_PDF_PAGES` raised will want
  more headroom.
- **Node version.** `node:sqlite` needs Node 22.13+, and `package.json` says so.
  Render's default for new services is 24.x, so this normally needs no action.
  To pin it, add a `NODE_VERSION` env var or a `.node-version` file.
- **Build.** `npm ci` installs `@napi-rs/canvas` from a prebuilt linux-x64
  binary, so no compiler toolchain is needed.

## Deploying to Wispbyte

Wispbyte is a Pterodactyl-style Docker panel rather than a PaaS. That trade is
good for this app: the free plan gives you a **real filesystem that survives
restarts**, which is exactly what the SQLite database needs — and what Render's
free tier refuses to provide.

Free servers get **512 MB RAM**. Peak RSS rendering a 20-page PDF measures
about 170 MB, so the free plan fits, with room for a few concurrent chats.

### A Python server works, even though this is a Node app

Panels pin the Docker image at creation, and it cannot be switched afterwards.
If yours is a **Python** image there is no `node` binary, so
`scripts/start.py` bootstraps one: it downloads a pinned Node release into the
server's own directory (no root, no image change), verifies it against Node's
published SHA-256, then installs dependencies and starts the app.

Node is cached in `NODE_HOME`, so the 30 MB download happens once per container
rather than on every restart. Set `NODE_HOME` to a path **outside the repo** —
`/home/container/node` is right for a panel — so redeploys don't wipe it.
Pruning build-only headers and docs brings the install to about 141 MB.

### Setup

1. On **Startup**, set the command:

   ```
   python3 scripts/start.py
   ```

2. Add environment variables:

   | Variable       | Value                                   |
   | -------------- | --------------------------------------- |
   | `NAGA_API_KEY` | your key from https://naga.ac/dashboard |
   | `DATA_DIR`     | `/home/container/data`                  |
   | `NODE_HOME`    | `/home/container/node`                  |

   `SERVER_PORT` is supplied by the panel and picked up automatically. `PORT`
   works too, when you run the app anywhere else.

3. Start the server, then copy the port from **Address** in the Console (the
   number after `:`) into your browser.

The first boot takes a minute or two while Node downloads. Later boots skip
straight to `npm ci` and start in seconds.

### Things to know

- **`python3` must exist in the image.** If the console says `python3: command
  not found`, try `python scripts/start.py`.
- **No `pip install` needed.** The launcher is pure stdlib, so there is no
  `requirements.txt` to install. It falls back to Node's `.tar.gz` when the
  image's Python was built without `lzma` (common in slim images).
- **Offline or blocked nodejs.org?** Point `NODE_DIST_URL` at a mirror, e.g.
  `https://npmmirror.com/mirrors/node`. You can also upload a Node tarball
  yourself: extract it into `NODE_HOME` and it will land at
  `NODE_HOME/node-v<version>-linux-<arch>`, which is where the script looks.
- **Keep the server awake.** Free servers stop after 2 weeks without a panel
  login. After 30 days your files move to cold storage (never deleted) and come
  back via **Restore files**.
- **CPU is capped at ~15% average.** Bulk-processing a large PDF library in one
  go can trip the automatic stop. Upload in small batches.
- **One account per person.** Extra free accounts to get more servers breaks
  their fair-use policy.
- **Public by default.** Anything you can reach on the port, anyone else can
  too. There is no login screen, so treat the URL as private and don't upload
  notes you would not want public.

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
