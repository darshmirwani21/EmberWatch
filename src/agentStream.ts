import type { AgentProgress } from '../shared/contracts';
import { apiBase } from './ui';

export async function streamAgentRequest<T>(path: string, input: unknown, signal: AbortSignal, onProgress: (progress: AgentProgress) => void, validate: (data: unknown) => T) {
  const response = await fetch(apiBase + '/api/agent/' + path, {
    method: 'POST', cache: 'no-store', signal, body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(typeof error?.error === 'string' ? error.error : 'The investigation API returned HTTP ' + response.status + '.');
  }
  if (!response.body) throw new Error('The investigation response was empty.');
  const stream = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const chunk = await stream.read();
      if (chunk.done) break;
      buffer += chunk.value;
      let end = buffer.indexOf('\n');
      while (end !== -1) {
        const payload = JSON.parse(buffer.slice(0, end)) as { event: 'progress'; data: AgentProgress } | { event: 'result'; data: unknown };
        buffer = buffer.slice(end + 1);
        if (payload.event === 'result') return validate(payload.data);
        onProgress(payload.data);
        end = buffer.indexOf('\n');
      }
    }
  } finally {
    await stream.cancel().catch(() => {});
  }
  throw new Error('The connection closed before the investigation finished.');
}
