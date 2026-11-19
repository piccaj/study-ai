import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, buildSystemPrompt, titleFromQuestion } from '../src/ai/prompt.js';

test('system prompt lists the notes and includes retrieved excerpts', () => {
  const prompt = buildSystemPrompt(
    [{ title: 'Biology', filename: 'bio.txt' }],
    [{ title: 'Biology', text: 'Mitochondria produce ATP.' }],
  );
  assert.match(prompt, /Study AI/);
  assert.match(prompt, /- Biology \(bio\.txt\)/);
  assert.match(prompt, /<excerpt note="Biology">/);
  assert.match(prompt, /Mitochondria produce ATP\./);
});

test('system prompt nudges uploads when there are no notes', () => {
  const prompt = buildSystemPrompt([], []);
  assert.match(prompt, /not uploaded any notes yet/);
  assert.doesNotMatch(prompt, /<excerpt/);
});

test('context is capped so a huge note cannot blow the prompt', () => {
  const prompt = buildSystemPrompt(
    [{ title: 'Big', filename: 'big.txt' }],
    [{ title: 'Big', text: 'word '.repeat(5000) }],
  );
  assert.ok(prompt.length < 9000, `prompt too long: ${prompt.length}`);
});

test('messages keep the recent history and append the new question', () => {
  const messages = buildMessages({
    question: 'What is ATP?',
    notes: [],
    excerpts: [],
    history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
  });
  assert.equal(messages[0].role, 'system');
  assert.equal(messages.at(-1).content, 'What is ATP?');
  assert.equal(messages.length, 1 + 12 + 1);
  assert.equal(messages[1].content, 'm8');
});

test('titles are trimmed to a readable length', () => {
  assert.equal(titleFromQuestion('  What   is  entropy? '), 'What is entropy?');
  const long = titleFromQuestion('x'.repeat(200));
  assert.equal(long.length, 58);
  assert.ok(long.endsWith('…'));
});
