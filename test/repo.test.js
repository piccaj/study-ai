import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createNotesRepo } from '../src/notes/repo.js';
import { createConversationsRepo } from '../src/conversations/repo.js';

const buffer = (text) => Buffer.from(text, 'utf8');

function setup() {
  const db = openDatabase(':memory:');
  return { db, notes: createNotesRepo(db), conversations: createConversationsRepo(db) };
}

test('notes are created, listed and deleted', () => {
  const { notes } = setup();
  const note = notes.create({
    title: 'Cell Biology',
    filename: 'cell.txt',
    mimetype: 'text/plain',
    buffer: buffer('The nucleus stores DNA.'),
    content: 'The nucleus stores DNA.',
  });

  assert.equal(note.title, 'Cell Biology');
  assert.equal(note.charCount, 'The nucleus stores DNA.'.length);
  assert.equal(notes.list().length, 1);
  assert.equal(notes.get(note.id).content, 'The nucleus stores DNA.');

  assert.equal(notes.remove(note.id), true);
  assert.equal(notes.list().length, 0);
  assert.equal(notes.get(note.id), null);
});

test('full-text search finds the note holding the term', () => {
  const { notes } = setup();
  const bio = notes.create({
    title: 'Biology',
    filename: 'bio.txt',
    mimetype: 'text/plain',
    buffer: buffer('Glycolysis splits glucose into pyruvate.'),
    content: 'Glycolysis splits glucose into pyruvate.',
  });
  notes.create({
    title: 'History',
    filename: 'hist.txt',
    mimetype: 'text/plain',
    buffer: buffer('The treaty was signed in 1648.'),
    content: 'The treaty was signed in 1648.',
  });

  const results = notes.search('glucose');
  assert.equal(results.length, 1);
  assert.equal(results[0].noteId, bio.id);
  assert.match(results[0].text, /Glycolysis/);
});

test('re-indexing replaces old chunks when content changes', () => {
  const { notes, db } = setup();
  const note = notes.create({
    title: 'Physics',
    filename: 'phys.txt',
    mimetype: 'text/plain',
    buffer: buffer('Newton described gravity.'),
    content: 'Newton described gravity.',
  });

  notes.updateContent(note.id, 'Einstein described spacetime curvature.');
  assert.equal(notes.search('gravity').length, 0);
  assert.equal(notes.search('spacetime').length, 1);

  const chunkCount = db.prepare('SELECT COUNT(*) AS n FROM note_chunks').get().n;
  assert.equal(chunkCount, 1);
});

test('deleting a note removes its chunks and search index rows', () => {
  const { notes, db } = setup();
  const note = notes.create({
    title: 'Chem',
    filename: 'chem.txt',
    mimetype: 'text/plain',
    buffer: buffer('Covalent bonds share electrons.'),
    content: 'Covalent bonds share electrons.',
  });
  notes.remove(note.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_chunks').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM note_chunks_fts').get().n, 0);
});

test('conversations keep their messages in order', () => {
  const { conversations } = setup();
  const conversation = conversations.create({ title: 'First session', model: 'test/model' });
  conversations.addMessage(conversation.id, 'user', 'What is entropy?');
  conversations.addMessage(conversation.id, 'assistant', 'A measure of disorder.');

  const loaded = conversations.get(conversation.id);
  assert.deepEqual(
    loaded.messages.map((m) => [m.role, m.content]),
    [
      ['user', 'What is entropy?'],
      ['assistant', 'A measure of disorder.'],
    ],
  );
  assert.equal(conversations.list()[0].messageCount, 2);
  assert.deepEqual(
    conversations.recentMessages(conversation.id, 1).map((m) => m.content),
    ['A measure of disorder.'],
  );
});

test('deleting a conversation cascades to its messages', () => {
  const { conversations, db } = setup();
  const conversation = conversations.create({});
  conversations.addMessage(conversation.id, 'user', 'hi');
  conversations.remove(conversation.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0);
});
