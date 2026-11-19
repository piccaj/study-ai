import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('html in model output is escaped', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('headings, lists and emphasis render', () => {
  const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two');
  assert.match(html, /<h2>Title<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
});

test('fenced code keeps its content and language', () => {
  const html = renderMarkdown('```python\nprint("<hi>")\n```');
  assert.match(html, /<pre><code class="language-python">/);
  assert.match(html, /print\("&lt;hi&gt;"\)/);
});

test('tables render with a header row', () => {
  const html = renderMarkdown('| Term | Meaning |\n| --- | --- |\n| ATP | energy |');
  assert.match(html, /<table><thead><tr><th>Term<\/th><th>Meaning<\/th><\/tr><\/thead>/);
  assert.match(html, /<td>ATP<\/td><td>energy<\/td>/);
});

test('only http(s) links become anchors', () => {
  const safe = renderMarkdown('[docs](https://example.com)');
  assert.match(safe, /<a href="https:\/\/example.com" target="_blank"/);
  const unsafe = renderMarkdown('[x](javascript:alert(1))');
  assert.doesNotMatch(unsafe, /<a /);
});

test('ordered lists and blockquotes render', () => {
  const html = renderMarkdown('1. first\n2. second\n\n> quoted');
  assert.match(html, /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
  assert.match(html, /<blockquote>quoted<\/blockquote>/);
});
