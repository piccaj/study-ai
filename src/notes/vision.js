export const DEFAULT_VISION_MODEL = 'google/gemini-2.5-flash-lite';

const PROMPT = `You are reading one page of a student's study material. Describe everything a blind reader would miss, so the description can be searched and used to answer questions later.

Cover, in this order:
- The page's overall layout and topic, in one sentence.
- Every diagram, figure, chart, graph or illustration: what it shows, its labels and axis names, trends, and the relationship it is teaching.
- Every table: reproduce it as a Markdown table with its real values.
- Any formulas, equations or symbols written as an image.
- Text that appears in the page image but may be missing from a text layer: captions, annotations, handwritten notes, sidebars, legends, headers and footers.

Be concrete and specific. Name the parts, values and labels you actually see. Do not guess at content you cannot read; say it is unclear instead. Do not add study advice or commentary. Return only the description.`;

/**
 * Ask a vision model to describe page images. Failures are collected per page
 * instead of thrown, so a partial description still improves the note.
 */
export async function describePages({ ai, model, pages, signal, concurrency = 4 }) {
  const results = new Array(pages.length);
  let cursor = 0;

  async function worker() {
    while (cursor < pages.length) {
      const page = pages[cursor];
      cursor += 1;
      try {
        const description = await ai.describeImage({
          model,
          prompt: PROMPT,
          image: page.data,
          mime: page.mime,
          signal,
        });
        results[page.idx] = { idx: page.idx, description, error: null };
      } catch (error) {
        results[page.idx] = { idx: page.idx, description: '', error: error?.message || 'Vision request failed.' };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pages.length) }, worker));
  return results.filter(Boolean).sort((a, b) => a.idx - b.idx);
}

/**
 * Fold page descriptions into the note's text so full-text search and the
 * chat prompt both see them. Each block is tagged with its page number.
 */
export function appendPageDescriptions(content, described) {
  const blocks = described
    .filter((page) => page.description?.trim())
    .map((page) => `[Page ${page.idx + 1} — visual description]\n${page.description.trim()}`);
  if (!blocks.length) return content;
  const base = stripPageDescriptions(content).trim();
  const separator = base ? '\n\n' : '';
  return `${base}${separator}${blocks.join('\n\n')}`;
}

const DESCRIPTION_BLOCK = /\n*\[Page \d+ — visual description\]\n[\s\S]*?(?=\n\n\[Page \d+ — visual description\]|$)/g;

/** Remove previously generated description blocks so vision can be re-run safely. */
export function stripPageDescriptions(content) {
  return String(content ?? '')
    .replace(DESCRIPTION_BLOCK, '')
    .trim();
}

