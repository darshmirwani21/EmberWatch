import { describe, expect, it, vi } from 'vitest';
import { investigate } from '../../server/agent';
import { requestCompletion, ProviderError, type Complete, type ToolCall } from '../../server/nvidia';
import { requestSchema } from '../../shared/contracts';
import { demos } from '../../shared/demos';
import { pointContact, simulate } from '../../shared/engine';

const input = { mode: 'civilian' as const, question: 'Analyze selected point', scenario: demos[0].scenario, point: demos[0].point };
const model = 'nvidia/nemotron-3.5-lightning-30b-a3b';
const call = (name: string, args: string, id = 'call_one'): ToolCall => ({ id, type: 'function', function: { name, arguments: args } });

describe('bounded agent', () => {
  it('dispatches real geometry and preserves tool call IDs without forwarding point coordinates', async () => {
    let turns = 0;
    const invoke: Complete = async (messages) => {
      expect(JSON.stringify(messages)).not.toContain(String(input.point!.lng));
      expect(JSON.stringify(messages)).not.toContain(String(input.point!.lat));
      if (++turns === 1) return { model, content: null, calls: [call('analyze_point_exposure', '{"scenario":"A"}')] };
      expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call_one' });
      return { model, content: '{"selectedEvidence":["E1"]}', calls: [] };
    };
    const result = await investigate(input, invoke);
    expect(result.status).toBe('completed');
    expect(result.toolTrace).toMatchObject([{ id: 'call_one', outcome: 'success', source: expect.stringContaining('SIMULATED') }]);
    expect(result.numericEvidence[0]).toMatchObject({ toolId: 'call_one', value: pointContact(simulate(input.scenario), input.point!)!.to });
  });
  it.each([
    ['unknown', '{}', 'allowlisted'],
    ['analyze_point_exposure', '{malformed', 'Malformed'],
    ['analyze_point_exposure', '{"scenario":"A","lat":120}', 'validation'],
  ])('rejects %s / %s', async (name, args, detail) => {
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [call(name, args)] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E1"]}', calls: [] });
    const result = await investigate(input, invoke);
    expect(result).toMatchObject({ status: 'unavailable', numericEvidence: [], toolTrace: [{ outcome: 'error', detail: expect.stringContaining(detail) }] });
  });
  it('rejects hallucinated evidence and model-composed numeric prose', async () => {
    const invoke = vi.fn<Complete>().mockResolvedValueOnce({ model, content: null, calls: [call('run_fire_simulation', '{"scenario":"A"}')] })
      .mockResolvedValue({ model, content: '{"selectedEvidence":["E99"],"summary":"999999 acres"}', calls: [] });
    const result = await investigate(input, invoke);
    expect(result.status).toBe('partial');
    expect(JSON.stringify(result)).not.toContain('999999');
  });
  it('keeps no-key failure honest and rejects out of range request context', async () => {
    const invoke = vi.fn<Complete>().mockRejectedValue(new ProviderError('Server NVIDIA credentials are missing.'));
    expect(await investigate(input, invoke)).toMatchObject({ status: 'unavailable', live: false, toolTrace: [] });
    expect(requestSchema.safeParse({ ...input, point: { lat: 100, lng: 200 } }).success).toBe(false);
    expect(requestSchema.safeParse({ ...input, addressBook: ['private'] }).success).toBe(false);
  });
  it('does not count plain completion alone as a tool investigation', async () => {
    const invoke = vi.fn<Complete>().mockResolvedValue({ model, content: 'Plain text', calls: [] });
    expect(await investigate(input, invoke)).toMatchObject({ status: 'unavailable', toolTrace: [], live: true });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('provider HTTP handling', () => {
  it.each([[401, 1], [403, 1], [429, 2], [503, 2]])('reports HTTP %i using %i attempts', async (status, attempts) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status }));
    await expect(requestCompletion(fetcher, 'https://example.invalid', {}, undefined, 0)).rejects.toThrow(String(status));
    expect(fetcher).toHaveBeenCalledTimes(attempts);
  });
  it('reports timeout without claiming a live response', async () => {
    const fetcher: typeof fetch = async (_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', reject, { once: true }));
    await expect(requestCompletion(fetcher, 'https://example.invalid', {}, undefined, 0, 3)).rejects.toThrow('timed out');
  });
});
