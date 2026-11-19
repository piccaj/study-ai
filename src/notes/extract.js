import { extname } from 'node:path';
import { normalize } from './chunk.js';

export const SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.pdf',
  '.docx',
  '.csv',
  '.json',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
];

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function isSupported(filename) {
  return SUPPORTED_EXTENSIONS.includes(extname(filename).toLowerCase());
}

export function isImage(filename) {
  return IMAGE_EXTENSIONS.has(extname(filename).toLowerCase());
}

/**
 * Extract plain text from an uploaded note. Throws UnsupportedFileError for
 * formats we cannot read so the API can answer with 415.
 */
export async function extractText({ buffer, filename, mimetype }) {
  const ext = extname(filename).toLowerCase();
  if (!isSupported(filename)) {
    throw new UnsupportedFileError(`Unsupported file type: ${ext || mimetype}`);
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
    return normalize(ext === '.html' || ext === '.htm' ? stripHtml(raw) : raw);
  }

  if (ext === '.pdf') return normalize(await extractPdf(buffer));
  if (ext === '.docx') return normalize(await extractDocx(buffer));

  // Images carry no text layer; their content arrives from the vision pass.
  if (IMAGE_EXTENSIONS.has(ext)) return '';

  throw new UnsupportedFileError(`Unsupported file type: ${ext}`);
}

async function extractPdf(buffer) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        text += item.str;
        text += item.hasEOL ? '\n' : ' ';
      }
      pages.push(text.trim());
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally {
    await task.destroy();
  }
}

async function extractDocx(buffer) {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export class UnsupportedFileError extends Error {}
