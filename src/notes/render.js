const DEFAULT_SCALE = 1.6;
const DEFAULT_MAX_PAGES = 20;
const MAX_EDGE = 1600;

/** How many pages of a PDF may be described, from `MAX_PDF_PAGES`. */
export function pageLimit() {
  const configured = Number(process.env.MAX_PDF_PAGES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_PAGES;
}

/**
 * Rasterize PDF pages to JPEG so a vision model can see diagrams, figures and
 * layout that text extraction drops. Pages are capped because each one costs a
 * vision request; `truncated` tells the caller the document was longer.
 */
export async function renderPdfPages(buffer, { maxPages = pageLimit(), scale = DEFAULT_SCALE } = {}) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const task = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: true,
    useWorkerFetch: false,
  });
  const doc = await task.promise;
  const pages = [];
  try {
    const limit = Math.min(doc.numPages, maxPages);
    for (let pageNo = 1; pageNo <= limit; pageNo += 1) {
      const page = await doc.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const fit = Math.min(scale, MAX_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: fit });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const data = await canvas.encode('jpeg', 82);
      pages.push({ idx: pages.length, mime: 'image/jpeg', width: canvas.width, height: canvas.height, data });
      page.cleanup();
    }
    return { pages, totalPages: doc.numPages, truncated: doc.numPages > limit };
  } finally {
    await task.destroy();
  }
}

/** Read an uploaded image and normalise it into a single page record. */
export async function loadImagePage(buffer, mime) {
  const { loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(Buffer.from(buffer));
  const width = image.width ?? image.naturalWidth ?? null;
  const height = image.height ?? image.naturalHeight ?? null;
  const mimeType = mime && mime.startsWith('image/') ? mime : 'image/png';
  return { pages: [{ idx: 0, mime: mimeType, width, height, data: Buffer.from(buffer) }], totalPages: 1, truncated: false };
}

