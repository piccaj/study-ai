import OpenAI from 'openai';

export const DEFAULT_BASE_URL = 'https://api.naga.ac/v1';
/**
 * Newest Flash-tier Gemini on NagaAI: "Google's most intelligent Flash model",
 * 1M context, reads text, images and PDFs. Roughly $0.001 per study answer.
 * Swap to google/gemini-2.5-pro or google/gemini-3.1-pro-preview for harder
 * reasoning at ~4x the price.
 */
export const DEFAULT_MODEL = 'google/gemini-3.8-flash';

const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

export function isModelId(value) {
  return typeof value === 'string' && MODEL_ID.test(value.trim());
}

export function createAiClient({
  apiKey = process.env.NAGA_API_KEY,
  baseURL = process.env.NAGA_BASE_URL || DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  const client = new OpenAI({ apiKey: apiKey || 'missing', baseURL, fetch: fetchImpl, maxRetries: 1 });

  return {
    get configured() {
      return Boolean(apiKey);
    },

    /** The catalog endpoint is public, so it works before a key is configured. */
    async listChatModels() {
      const res = await fetchImpl(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });
      if (!res.ok) throw new Error(`Could not load the NagaAI model list (HTTP ${res.status}).`);
      const { data = [] } = await res.json();
      return data
        .filter(isChatModel)
        .map((m) => ({ id: m.id, label: m.display_name || m.id, vision: supportsImages(m) }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },

    /**
     * Stream a chat completion, yielding text deltas as they arrive.
     */
    async *streamChat({ model, messages, signal }) {
      const stream = await client.chat.completions.create({ model, messages, stream: true }, { signal });
      for await (const part of stream) {
        const delta = part.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    },

    /** One-shot vision call used to describe a page image at upload time. */
    async describeImage({ model, prompt, image, mime = 'image/png', signal }) {
      const completion = await client.chat.completions.create(
        {
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mime};base64,${Buffer.from(image).toString('base64')}` },
                },
              ],
            },
          ],
        },
        { signal },
      );
      return completion.choices?.[0]?.message?.content?.trim() ?? '';
    },
  };
}

function supportsImages(model) {
  const modalities = model.architecture?.input_modalities ?? [];
  return modalities.includes('image');
}

function isChatModel(model) {
  const kinds = model.kinds ?? [];
  const operations = model.operations ?? [];
  return (
    kinds.includes('chat') ||
    kinds.length === 0 ||
    operations.some((op) => op.operation === 'chat' || op.kind === 'chat')
  );
}
