import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';
import { appendPageDescriptions, describePages, DEFAULT_VISION_MODEL } from '../src/notes/vision.js';
import { makePdf, makePng } from './helpers/files.js';

function fakeAi({ description = 'A labelled diagram of the Calvin cycle.', fail = false } = {}) {
  const calls = [];
  return {
    calls,
    configured: true,
    async listChatModels() {
      return [{ id: 'fake/model', label: 'Fake Model', vision: true }];
    },
    async describeImage(request) {
      calls.push(request);
      if (fail) throw Object.assign(new Error('model cannot read images'), { status: 400 });
      return description;
    },
    async *streamChat() {
      yield 'ok';
    },
  };
}

async function startServer(app) {
  const server = app.listen(0);
  await once(server, 'listening');
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function upload(base, name, blob) {
  const form = new FormData();
  form.append('file', blob, name);
  const res = await fetch(`${base}/api/notes`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

test('a PDF upload is rendered to pages and described by the vision model', async () => {
  const ai = fakeAi();
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const { status, body } = await upload(
      base,
      'lecture.pdf',
      new Blob([makePdf('Photosynthesis overview')], { type: 'application/pdf' }),
    );
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.note.pageCount, 1);
    assert.equal(body.note.visionStatus, 'done');
    assert.equal(body.note.visionModel, DEFAULT_VISION_MODEL);
    assert.equal(ai.calls.length, 1);
    assert.match(ai.calls[0].image.toString('latin1', 0, 2), /^\xff\xd8/, 'page image is a JPEG');
    assert.match(body.note.content, /Photosynthesis overview/);
    assert.match(body.note.content, /\[Page 1 — visual description\]/);
    assert.match(body.note.content, /Calvin cycle/);
  } finally {
    await close();
  }
});

test('a diagram uploaded as an image becomes a searchable note', async () => {
  const ai = fakeAi({ description: 'A flowchart: light reactions feed ATP and NADPH into the Calvin cycle.' });
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const png = await makePng();
    const { status, body } = await upload(base, 'diagram.png', new Blob([png], { type: 'image/png' }));
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.note.visionStatus, 'done');
    assert.equal(body.note.charCount > 0, true);

    const pages = await (await fetch(`${base}/api/notes/${body.note.id}`)).json();
    assert.equal(pages.note.pages.length, 1);
    assert.match(pages.note.pages[0].description, /flowchart/);

    const image = await fetch(`${base}/api/notes/${body.note.id}/pages/0`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal((await image.arrayBuffer()).byteLength, png.length);
  } finally {
    await close();
  }
});

test('descriptions are searchable so chat can ground answers in diagrams', async () => {
  const ai = fakeAi({ description: 'Bar chart of enzyme activity peaking at 37 degrees Celsius.' });
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const png = await makePng();
    await upload(base, 'graph.png', new Blob([png], { type: 'image/png' }));

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What temperature do the enzymes peak at?' }),
    });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /graph/);
    assert.match(body, /event: meta/);
  } finally {
    await close();
  }
});

test('a failing vision model still saves the note text', async () => {
  const ai = fakeAi({ fail: true });
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const { status, body } = await upload(
      base,
      'lecture.pdf',
      new Blob([makePdf('Krebs cycle summary')], { type: 'application/pdf' }),
    );
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.note.visionStatus, 'failed');
    assert.match(body.note.content, /Krebs cycle summary/);
    assert.match(body.vision.error, /cannot read images/);
  } finally {
    await close();
  }
});

test('pages are stored without an API key so vision can run later', async () => {
  const ai = { ...fakeAi(), configured: false };
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const { status, body } = await upload(
      base,
      'lecture.pdf',
      new Blob([makePdf('Glycolysis steps')], { type: 'application/pdf' }),
    );
    assert.equal(status, 201, JSON.stringify(body));
    assert.equal(body.note.visionStatus, 'none');
    assert.equal(body.note.pageCount, 1, 'pages are rendered even with vision off');
    assert.equal(ai.calls.length, 0);

    const retry = await fetch(`${base}/api/notes/${body.note.id}/vision`, { method: 'POST' });
    assert.equal(retry.status, 503);
  } finally {
    await close();
  }
});

test('vision off stores pages but makes no model calls', async () => {
  const ai = fakeAi();
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const form = new FormData();
    form.append('file', new Blob([makePdf('Cell theory')], { type: 'application/pdf' }), 'cells.pdf');
    form.append('vision', 'off');
    const res = await fetch(`${base}/api/notes`, { method: 'POST', body: form });
    const { note } = await res.json();

    assert.equal(res.status, 201);
    assert.equal(note.visionStatus, 'none');
    assert.equal(note.pageCount, 1);
    assert.equal(ai.calls.length, 0);
    assert.doesNotMatch(note.content, /visual description/);
  } finally {
    await close();
  }
});


test('vision can be re-run on a stored note', async () => {
  const ai = fakeAi({ description: 'A table of mitosis phases and their checkpoints.' });
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const png = await makePng();
    const first = await upload(base, 'cells.png', new Blob([png], { type: 'image/png' }));
    const before = ai.calls.length;

    const res = await fetch(`${base}/api/notes/${first.body.note.id}/vision`, { method: 'POST' });
    assert.equal(res.status, 200);
    const { note } = await res.json();
    assert.equal(ai.calls.length, before + 1);
    assert.equal(note.visionStatus, 'done');
    // Re-running must not duplicate the description blocks.
    assert.equal(note.content.match(/\[Page 1 — visual description\]/g).length, 1);
  } finally {
    await close();
  }
});

test('describePages reports per-page errors without throwing', async () => {
  const ai = {
    async describeImage({ image }) {
      if (image[0] === 2) throw new Error('boom');
      return 'fine';
    },
  };
  const pages = [
    { idx: 0, mime: 'image/png', data: Buffer.from([1]) },
    { idx: 1, mime: 'image/png', data: Buffer.from([2]) },
  ];
  const results = await describePages({ ai, model: 'fake/model', pages });
  assert.deepEqual(
    results.map((r) => [r.idx, r.description, r.error]),
    [
      [0, 'fine', null],
      [1, '', 'boom'],
    ],
  );
});

test('appendPageDescriptions tags pages and skips empty ones', () => {
  const merged = appendPageDescriptions('Base text.', [
    { idx: 0, description: 'First diagram.' },
    { idx: 1, description: '' },
    { idx: 2, description: 'Third diagram.' },
  ]);
  assert.match(merged, /^Base text\./);
  assert.match(merged, /\[Page 1 — visual description\]\nFirst diagram\./);
  assert.match(merged, /\[Page 3 — visual description\]\nThird diagram\./);
  assert.doesNotMatch(merged, /Page 2/);
});

test('a note with no text and no descriptions stays empty', () => {
  assert.equal(appendPageDescriptions('', [{ idx: 0, description: '' }]), '');
});

test('re-applying descriptions replaces them instead of stacking up', () => {
  const first = appendPageDescriptions('Body text.', [{ idx: 0, description: 'Old description.' }]);
  const second = appendPageDescriptions(first, [{ idx: 0, description: 'New description.' }]);
  assert.equal(second.match(/\[Page 1 — visual description\]/g).length, 1);
  assert.match(second, /New description\./);
  assert.doesNotMatch(second, /Old description\./);
  assert.match(second, /^Body text\./);
});

test('applyVision with no descriptions leaves the note unchanged', async () => {
  const { createNotesRepo } = await import('../src/notes/repo.js');
  const notes = createNotesRepo(openDatabase(':memory:'));
  const note = notes.create({
    title: 'Empty',
    filename: 'a.txt',
    mimetype: 'text/plain',
    buffer: Buffer.from('Body.'),
    content: 'Body.',
  });
  const before = notes.get(note.id);
  const after = notes.applyVision(note.id, { descriptions: [], model: 'fake/model' });
  assert.equal(after.content, before.content);
  assert.equal(after.visionStatus, 'none');
});
