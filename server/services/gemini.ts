import { createHash } from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { NotConfiguredError, UpstreamError } from '../lib/errors.js';
import { remember, type Cache } from '../lib/cache.js';

let client: GoogleGenAI | null = null;
const getClient = () => {
  if (!config.keys.gemini) throw new NotConfiguredError('Gemini (GEMINI_API_KEY)');
  return (client ??= new GoogleGenAI({ apiKey: config.keys.gemini }));
};

export const geminiAvailable = () => Boolean(config.keys.gemini);

/**
 * JSON-mode generation, cached by prompt hash. The key stays on the server; the browser only ever
 * calls our /api routes. Output is parsed defensively - callers must still validate the shape.
 */
export async function generateJson<T>(cache: Cache, prompt: string, ttlSeconds = 3600): Promise<T> {
  const key = 'gemini:' + createHash('sha256').update(config.geminiModel + '\n' + prompt).digest('hex');
  return remember(cache, key, ttlSeconds, async () => {
    try {
      const res = await getClient().models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });
      const text = (res.text ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof NotConfiguredError) throw err;
      throw new UpstreamError('gemini', err instanceof Error ? err.message : String(err));
    }
  });
}
