import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, normalize } from '../src/notes/chunk.js';

test('normalize collapses noisy whitespace', () => {
  assert.equal(normalize('a  \r\n\r\n\r\nb   \n'), 'a\n\nb');
});

test('short text stays a single chunk', () => {
  assert.deepEqual(chunkText('Photosynthesis converts light into sugar.'), [
    'Photosynthesis converts light into sugar.',
  ]);
});

test('long text is split into chunks under the target size', () => {
  const paragraph = 'Mitochondria produce ATP through oxidative phosphorylation. '.repeat(6);
  const text = Array.from({ length: 12 }, () => paragraph).join('\n\n');
  const chunks = chunkText(text, { target: 1000 });
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 1000, `chunk too long: ${chunk.length}`);
  assert.equal(chunks.join('').replace(/\s+/g, '').length, normalize(text).replace(/\s+/g, '').length);
});

test('an unbroken block longer than the target is split', () => {
  const chunks = chunkText('x'.repeat(2500), { target: 1000 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks.join('').length, 2500);
});

test('empty input yields no chunks', () => {
  assert.deepEqual(chunkText('   \n\n  '), []);
});
