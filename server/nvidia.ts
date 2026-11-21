import 'dotenv/config';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

export const modelId = process.env.NVIDIA_MODEL?.trim() || 'nvidia/nemotron-3.5-lightning-30b-a3b';
const apiKey = process.env.NVIDIA_API_KEY?.trim();
const base = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');
export const credentialsConfigured = Boolean(apiKey);

export const callSchema = z.object({
  id: z.string().min(1).max(200), type: z.literal('function'),
  function: z.object({ name: z.string().max(100), arguments: z.string().max(6000) }),
});
export type ToolCall = z.infer<typeof callSchema>;
export type Message = { role: 'user' | 'system' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
export type Tool = { type: 'function'; function: { name: string; description: string; parameters: object } };
const completionSchema = z.object({
  model: z.string().min(1).max(200),
  choices: z.array(z.object({ message: z.object({
    content: z.string().nullish(), tool_calls: z.array(callSchema).max(8).nullish(),
  }) })).min(1),
});
export type Complete = (messages: Message[], tools?: Tool[], signal?: AbortSignal) => Promise<{ model: string; content: string | null; calls: ToolCall[] }>;

export class ProviderError extends Error {}
export async function requestCompletion(
  fetcher: typeof fetch, url: string, init: RequestInit, budget?: AbortSignal, retryMs = 420, timeoutMs = 15_000,
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = budget ? AbortSignal.any([budget, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal, redirect: 'error' });
    } catch {
      const timedOut = signal.aborted;
      if (attempt === 0 && !budget?.aborted) {
        await delay(retryMs);
        continue;
      }
      throw new ProviderError(timedOut ? 'NVIDIA request timed out.' : 'NVIDIA endpoint could not be reached.');
    }
    if (response.ok) {
      const result = await response.json().catch(() => null);
      if (result === null && signal.aborted) throw new ProviderError('NVIDIA request timed out.');
      return result;
    }
    const status = response.status;
    const retryAfter = response.headers.get('retry-after');
    await response.body?.cancel().catch(() => {});
    if ((status === 429 || status >= 500) && attempt === 0 && !budget?.aborted) {
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      await delay(Number.isFinite(seconds) ? Math.min(2500, Math.max(retryMs, seconds * 1000)) : retryMs);
      continue;
    }
    if (status === 401 || status === 403) throw new ProviderError('NVIDIA rejected the configured credentials or model access (HTTP ' + status + ').');
    if (status === 429) throw new ProviderError('NVIDIA rate limit reached (HTTP 429). Retry shortly.');
    throw new ProviderError('NVIDIA request failed (HTTP ' + status + ').');
  }
  throw new ProviderError('NVIDIA request budget exhausted.');
}

export const complete: Complete = async (messages, tools, signal) => {
  if (!apiKey) throw new ProviderError('Server NVIDIA credentials are missing.');
  if (!modelId.toLowerCase().includes('nemotron')) throw new ProviderError('The configured model must be a Nemotron model.');
  const result = await requestCompletion(fetch, base + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: modelId, messages, stream: false, temperature: 0.4, max_tokens: 1800,
      ...(modelId.includes('3.5-lightning') ? { chat_template_kwargs: { enable_thinking: true }, reasoning_budget: 700 } : {}),
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
  }, signal);
  const parsed = completionSchema.safeParse(result);
  if (!parsed.success || !parsed.data.model.toLowerCase().includes('nemotron')) {
    throw new ProviderError('NVIDIA returned an incompatible completion response.');
  }
  const { content, tool_calls } = parsed.data.choices[0].message;
  return { model: parsed.data.model, content: content ?? null, calls: tool_calls ?? [] };
};
