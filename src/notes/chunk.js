const TARGET_CHARS = 1400;
const MIN_CHARS = 200;

export function chunkText(text, { target = TARGET_CHARS } = {}) {
  const clean = normalize(text);
  if (!clean) return [];
  if (clean.length <= target) return [clean];

  const chunks = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  for (const block of clean.split(/\n{2,}/)) {
    if (block.length > target) {
      flush();
      chunks.push(...splitLongBlock(block, target));
      continue;
    }
    if ((current + '\n\n' + block).length > target) flush();
    current = current ? `${current}\n\n${block}` : block;
  }
  flush();

  return mergeTinyChunks(chunks, target);
}

function splitLongBlock(block, target) {
  const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block];
  const out = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > target) {
      if (current.trim()) out.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += target) {
        out.push(sentence.slice(i, i + target).trim());
      }
      continue;
    }
    if ((current + sentence).length > target) {
      out.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) out.push(current.trim());
  return out.filter(Boolean);
}

function mergeTinyChunks(chunks, target) {
  const out = [];
  for (const chunk of chunks) {
    const last = out[out.length - 1];
    if (last && last.length < MIN_CHARS && last.length + chunk.length <= target) {
      out[out.length - 1] = `${last}\n\n${chunk}`;
    } else {
      out.push(chunk);
    }
  }
  return out;
}

export function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
