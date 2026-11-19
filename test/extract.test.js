import test from 'node:test';
import assert from 'node:assert/strict';
import { extractText, isSupported, UnsupportedFileError } from '../src/notes/extract.js';
import { makePdf, makeDocx } from './helpers/files.js';

test('supported extensions are recognised', () => {
  assert.equal(isSupported('notes.pdf'), true);
  assert.equal(isSupported('notes.PDF'), true);
  assert.equal(isSupported('notes.docx'), true);
  assert.equal(isSupported('notes.exe'), false);
  assert.equal(isSupported('notes'), false);
});

test('plain text and markdown are read directly', async () => {
  const text = await extractText({ buffer: Buffer.from('Hello  world\r\n'), filename: 'a.txt', mimetype: 'text/plain' });
  assert.equal(text, 'Hello world');
});

test('html is stripped to text', async () => {
  const html = '<html><body><h1>Title</h1><p>Body &amp; more</p></body></html>';
  const text = await extractText({ buffer: Buffer.from(html), filename: 'a.html', mimetype: 'text/html' });
  assert.match(text, /Title/);
  assert.match(text, /Body & more/);
  assert.doesNotMatch(text, /<p>/);
});

test('pdf text is extracted', async () => {
  const text = await extractText({
    buffer: makePdf('Osmosis moves water across a membrane'),
    filename: 'lecture.pdf',
    mimetype: 'application/pdf',
  });
  assert.match(text, /Osmosis moves water/);
});

test('docx text is extracted', async () => {
  const text = await extractText({
    buffer: makeDocx('Enzymes lower activation energy'),
    filename: 'lecture.docx',
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  assert.match(text, /Enzymes lower activation energy/);
});

test('unsupported types throw UnsupportedFileError', async () => {
  await assert.rejects(
    extractText({ buffer: Buffer.from('x'), filename: 'a.png', mimetype: 'image/png' }),
    UnsupportedFileError,
  );
});
