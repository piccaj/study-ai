const MAX_CONTEXT_CHARS = 6000;
const MAX_HISTORY_MESSAGES = 12;

export const SYSTEM_PROMPT = `You are Study AI, a patient and encouraging tutor.

How you teach:
- Explain ideas in plain language first, then add depth. Prefer short paragraphs and concrete examples.
- Use the student's own notes when they are provided, and say which note you are drawing from.
- Some note text comes from a vision pass over page images, marked "[Page N — visual description]". Treat it as a description of a diagram, table or figure, and mention the figure when you use it.
- When the notes do not cover something, say so and answer from general knowledge, clearly flagged as not from their notes.
- Check understanding with a question now and then, and offer practice problems or flashcards when they help.
- Use Markdown for structure: headings, lists, tables and fenced code blocks with a language tag.
- Never invent quotes from the notes.`;

/**
 * Build the message array sent to the model: system prompt with the retrieved
 * note excerpts, then recent conversation history, then the new question.
 */
export function buildMessages({ question, notes, excerpts, history = [] }) {
  return [
    { role: 'system', content: buildSystemPrompt(notes, excerpts) },
    ...trimHistory(history),
    { role: 'user', content: question },
  ];
}

export function buildSystemPrompt(notes = [], excerpts = []) {
  const sections = [SYSTEM_PROMPT];

  if (notes.length) {
    sections.push(
      `The student has ${notes.length} uploaded note${notes.length === 1 ? '' : 's'}:\n` +
        notes.map((n) => `- ${n.title} (${n.filename})`).join('\n'),
    );
  } else {
    sections.push('The student has not uploaded any notes yet. Encourage them to upload lecture notes, slides or a textbook chapter.');
  }

  if (excerpts.length) {
    let budget = MAX_CONTEXT_CHARS;
    const blocks = [];
    for (const excerpt of excerpts) {
      if (budget <= 0) break;
      const text = excerpt.text.length > budget ? `${excerpt.text.slice(0, budget)}…` : excerpt.text;
      budget -= text.length;
      blocks.push(`<excerpt note="${escapeAttr(excerpt.title)}">\n${text}\n</excerpt>`);
    }
    sections.push(
      `Excerpts retrieved from the student's notes for this question:\n\n${blocks.join('\n\n')}`,
    );
  }

  return sections.join('\n\n');
}

function trimHistory(history) {
  const messages = history
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }));
  return messages.slice(-MAX_HISTORY_MESSAGES);
}

function escapeAttr(value) {
  return String(value).replace(/"/g, '&quot;');
}

export function titleFromQuestion(question) {
  const clean = String(question).replace(/\s+/g, ' ').trim();
  if (!clean) return 'New study session';
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean;
}
