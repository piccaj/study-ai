import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/server.js';

/** Fake NagaAI client that streams a canned answer and records the request. */
function fakeAi({ answer = 'Photosynthesis converts light into chemical energy.', configured = true } = {}) {
  const calls = [];
  return {
    calls,
    configured,
    async listChatModels() {
      return [{ id: 'fake/model', label: 'Fake Model' }];
    },
    async *streamChat(request) {
      calls.push(request);
      for (const word of answer.split(' ')) yield `${word} `;
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

function parseSse(body) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? 'null');
      return { event, data };
    });
}

async function uploadNote(base, name, content) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  const res = await fetch(`${base}/api/notes`, { method: 'POST', body: form });
  const payload = await res.json();
  assert.equal(res.status, 201, JSON.stringify(payload));
  return payload.note;
}

test('health endpoint reports API key state', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi({ configured: false }) });
  const { base, close } = await startServer(app);
  try {
    const res = await fetch(`${base}/api/health`);
    assert.deepEqual(await res.json(), { ok: true, apiKeyConfigured: false });
  } finally {
    await close();
  }
});

test('uploading a note stores its text and indexes it', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const note = await uploadNote(base, 'bio-notes.txt', 'Mitochondria are the powerhouse of the cell.');
    assert.equal(note.title, 'bio notes');
    assert.equal(note.charCount, 'Mitochondria are the powerhouse of the cell.'.length);

    const list = await (await fetch(`${base}/api/notes`)).json();
    assert.equal(list.notes.length, 1);
    assert.ok(list.supported.includes('.pdf'));

    const detail = await (await fetch(`${base}/api/notes/${note.id}`)).json();
    assert.match(detail.note.content, /Mitochondria/);
  } finally {
    await close();
  }
});

test('unsupported uploads are rejected with 415', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const form = new FormData();
    form.append('file', new Blob(['binary'], { type: 'application/zip' }), 'archive.zip');
    const res = await fetch(`${base}/api/notes`, { method: 'POST', body: form });
    assert.equal(res.status, 415);
  } finally {
    await close();
  }
});

test('a corrupt image is rejected without a server error', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const form = new FormData();
    form.append('file', new Blob(['not really a png'], { type: 'image/png' }), 'broken.png');
    const res = await fetch(`${base}/api/notes`, { method: 'POST', body: form });
    assert.equal(res.status, 422);
  } finally {
    await close();
  }
});

test('chat streams an answer, creates a session and remembers it', async () => {
  const ai = fakeAi({ answer: 'ATP is the energy currency of the cell.' });
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    await uploadNote(base, 'atp.txt', 'ATP hydrolysis releases energy for cellular work.');

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What is ATP?' }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const events = parseSse(await res.text());
    const meta = events.find((e) => e.event === 'meta').data;
    const done = events.find((e) => e.event === 'done').data;

    assert.ok(meta.conversationId);
    assert.equal(meta.title, 'What is ATP?');
    assert.equal(meta.sources[0].title, 'atp');
    assert.equal(
      events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''),
      'ATP is the energy currency of the cell. ',
    );
    assert.equal(done.message.role, 'assistant');

    const request = ai.calls[0];
    assert.equal(request.messages[0].role, 'system');
    assert.match(request.messages[0].content, /ATP hydrolysis/);
    assert.equal(request.messages.at(-1).content, 'What is ATP?');

    const saved = await (await fetch(`${base}/api/conversations/${meta.conversationId}`)).json();
    assert.deepEqual(
      saved.conversation.messages.map((m) => m.role),
      ['user', 'assistant'],
    );

    const followUp = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: meta.conversationId, message: 'And how is it made?' }),
    });
    parseSse(await followUp.text());
    const history = ai.calls[1].messages.map((m) => m.content);
    assert.ok(history.includes('What is ATP?'), 'previous question is sent as history');
    assert.ok(history.includes('ATP is the energy currency of the cell. '), 'previous answer is sent as history');
  } finally {
    await close();
  }
});

test('chat without an API key returns 503', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi({ configured: false }) });
  const { base, close } = await startServer(app);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /NAGA_API_KEY/);
  } finally {
    await close();
  }
});

test('empty messages are rejected', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('conversations can be listed, renamed and deleted', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const created = await (
      await fetch(`${base}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Physics' }),
      })
    ).json();
    const id = created.conversation.id;

    const renamed = await (
      await fetch(`${base}/api/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Physics revision' }),
      })
    ).json();
    assert.equal(renamed.conversation.title, 'Physics revision');

    const list = await (await fetch(`${base}/api/conversations`)).json();
    assert.equal(list.conversations[0].title, 'Physics revision');

    const del = await fetch(`${base}/api/conversations/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
    assert.equal((await (await fetch(`${base}/api/conversations`)).json()).conversations.length, 0);
  } finally {
    await close();
  }
});

test('the selected model is persisted and used for chat', async () => {
  const ai = fakeAi();
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fake/model' }),
    });
    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.model, 'fake/model');
    assert.equal(settings.apiKeyConfigured, true);

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    parseSse(await res.text());
    assert.equal(ai.calls[0].model, 'fake/model');

    const models = await (await fetch(`${base}/api/settings/models`)).json();
    assert.deepEqual(models.models, [{ id: 'fake/model', label: 'Fake Model' }]);
  } finally {
    await close();
  }
});

test('settings reject malformed model ids and keep valid ones', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const bad = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'google/gemini-2.5-flashgoogle/gemini-2.5-flash:free' }),
    });
    assert.equal(bad.status, 400);

    const good = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'fake/model' }),
    });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { model: 'fake/model', visionModel: 'google/gemini-3.8-flash' });

    const settings = await (await fetch(`${base}/api/settings`)).json();
    assert.equal(settings.model, 'fake/model');

    const unknown = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nobody/not-in-catalog' }),
    });
    assert.equal(unknown.status, 400);
  } finally {
    await close();
  }
});

test('chat ignores an invalid model id and falls back to the saved model', async () => {
  const ai = fakeAi();
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const note = await uploadNote(base, 'bio.txt', 'Chlorophyll absorbs blue and red light.');
    assert.ok(note.id);

    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What does chlorophyll absorb?', model: 'not a model id' }),
    });
    assert.equal(res.status, 200);
    await res.text();
    assert.equal(ai.calls.length, 1);
    assert.match(ai.calls[0].model, /^[a-z0-9][\w.-]*\/[\w.:-]+$/i);
  } finally {
    await close();
  }
});

test('patching a note updates title and content together', async () => {
  const app = createApp({ db: openDatabase(':memory:'), ai: fakeAi() });
  const { base, close } = await startServer(app);
  try {
    const note = await uploadNote(base, 'old.txt', 'Original body about mitosis.');
    const res = await fetch(`${base}/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Cell division', content: 'Rewritten body about meiosis.' }),
    });
    assert.equal(res.status, 200);
    const { note: updated } = await res.json();
    assert.equal(updated.title, 'Cell division');
    assert.equal(updated.content, 'Rewritten body about meiosis.');
    assert.equal(updated.charCount, 'Rewritten body about meiosis.'.length);

    const emptyTitle = await fetch(`${base}/api/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    assert.equal(emptyTitle.status, 400);
  } finally {
    await close();
  }
});

test('streaming is not aborted while the client is still reading', async () => {
  const signals = [];
  const ai = {
    configured: true,
    async listChatModels() {
      return [{ id: 'fake/model', label: 'Fake Model' }];
    },
    async *streamChat({ signal }) {
      signals.push(signal);
      for (const word of ['Alpha ', 'Beta ', 'Gamma']) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(signal.aborted, false, 'stream was aborted mid-answer');
        yield word;
      }
    },
  };
  const app = createApp({ db: openDatabase(':memory:'), ai });
  const { base, close } = await startServer(app);
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Say the Greek letters' }),
    });
    const events = parseSse(await res.text());
    assert.equal(events.at(-1).event, 'done');
    assert.equal(events.at(-1).data.message.content, 'Alpha Beta Gamma');
    assert.equal(signals[0].aborted, false);
  } finally {
    await close();
  }
});
