import OpenAI from 'openai';

export const DEFAULT_BASE_URL = 'https://api.naga.ac/v1';
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

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
        .map((m) => ({ id: m.id, label: m.display_name || m.id }))
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
  };
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
