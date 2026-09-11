/**
 * Reproduction test: streaming token double-counting hypothesis
 *
 * Hypothesis:
 *   OpenRouter (with stream_options.include_usage) emits CUMULATIVE usage figures —
 *   each usage chunk contains the total so far, not just the delta for that chunk.
 *   The current implementation uses `+=` to accumulate, which would add these
 *   cumulative values together and double-count tokens when more than one
 *   usage-bearing chunk arrives.
 *
 * This file proves or disproves that hypothesis without making any real provider
 * calls. All chunks are synthesized by fakeStream().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type { ChatMessageSchema } from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// Mock wiring (same pattern as ai-streaming-token-usage.test.ts)
// ---------------------------------------------------------------------------
const { sendRequestMock } = vi.hoisted(() => ({ sendRequestMock: vi.fn() }));

vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({ sendRequest: sendRequestMock }) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

type StreamingRequest = OpenAI.Chat.ChatCompletionCreateParamsStreaming;

async function* fakeStream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) yield chunk;
}

function mockStream(chunks: unknown[]): { request?: StreamingRequest } {
  const captured: { request?: StreamingRequest } = {};
  sendRequestMock.mockImplementation(async (fn: (client: unknown) => unknown) => {
    const client = {
      chat: {
        completions: {
          create: (req: StreamingRequest) => {
            captured.request = req;
            return fakeStream(chunks);
          },
        },
      },
    };
    return { result: await fn(client), source: 'self-hosted' };
  });
  return captured;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function collectUsageEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  chunks: unknown[]
): Promise<Array<{ promptTokens?: number; completionTokens?: number; totalTokens?: number }>> {
  mockStream(chunks);
  const usageEvents: Array<{
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }> = [];
  for await (const event of service.streamChat(
    [{ role: 'user', content: 'Hello' }] as ChatMessageSchema[],
    { model: 'openai/gpt-4o' }
  )) {
    if ('tokenUsage' in event && event.tokenUsage) {
      usageEvents.push(
        event.tokenUsage as {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        }
      );
    }
  }
  return usageEvents;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('streaming token double-counting reproduction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(async () => {
    sendRequestMock.mockReset();
    vi.resetModules();
    const mod = await import('../../src/services/ai/chat-completion.service.js');
    service = mod.ChatCompletionService.getInstance();
  });

  // -------------------------------------------------------------------------
  // Test 1 — Baseline (single usage chunk, ideal case)
  // Confirms the happy path still holds. This should always pass.
  // -------------------------------------------------------------------------
  it('[baseline] single cumulative usage chunk → correct totals', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hello' } }], usage: null },
      { choices: [{ delta: { content: ' world' } }], usage: null },
      // Provider emits ONE final usage chunk with totals.
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ];

    const usageEvents = await collectUsageEvents(service, chunks);

    // Expect exactly one event with correct totals.
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  // -------------------------------------------------------------------------
  // Test 2 — THE REPRODUCTION
  //
  // Some providers send intermediate usage chunks (e.g., partial counts per
  // turn) AND a final cumulative chunk. Because `stream_options.include_usage`
  // is enabled, any chunk can carry a non-null usage object.
  //
  // Scenario: the provider emits THREE usage-bearing chunks with CUMULATIVE
  // figures. After each content burst it reports "this many tokens so far":
  //
  //   Chunk A: usage = { prompt: 10, completion: 3, total: 13 }  ← after turn 1
  //   Chunk B: usage = { prompt: 10, completion: 7, total: 17 }  ← after turn 2
  //   Chunk C: usage = { prompt: 10, completion: 10, total: 20 } ← final total
  //
  // Correct behaviour (replace on each chunk): final reported = 10 / 10 / 20
  // Buggy behaviour (+=  on each chunk):       final reported = 30 / 20 / 50
  // -------------------------------------------------------------------------
  it('[REPRODUCTION] multiple cumulative usage chunks → reveals +=/replace mismatch', async () => {
    const CHUNK_A_USAGE = { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 };
    const CHUNK_B_USAGE = { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 };
    const CHUNK_C_USAGE = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }; // final totals

    const chunks = [
      { choices: [{ delta: { content: 'First' } }], usage: CHUNK_A_USAGE },
      { choices: [{ delta: { content: ' second' } }], usage: CHUNK_B_USAGE },
      { choices: [], usage: CHUNK_C_USAGE },
    ];

    const usageEvents = await collectUsageEvents(service, chunks);

    // --- What the CORRECT behaviour should be ---
    // Each usage chunk is cumulative. The last one contains the true total.
    // The service should yield the last chunk's values as the final reported usage.
    const CORRECT_FINAL = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };

    // --- What the BUGGY behaviour (+=) produces ---
    // 10+10+10 = 30 prompt, 3+7+10 = 20 completion, 13+17+20 = 50 total
    const BUGGY_FINAL = { promptTokens: 30, completionTokens: 20, totalTokens: 50 };

    // There will be 3 usage events (one per chunk — the code yields on every
    // usage-bearing chunk). We care about the LAST one: the final reported total.
    const lastEvent = usageEvents[usageEvents.length - 1];

    console.log('\n--- REPRODUCTION REPORT ---');
    console.log('Provider sent (cumulative per chunk):');
    console.log('  Chunk A:', CHUNK_A_USAGE);
    console.log('  Chunk B:', CHUNK_B_USAGE);
    console.log('  Chunk C (final):', CHUNK_C_USAGE);
    console.log('Current implementation last emitted:', lastEvent);
    console.log('Expected (replace / correct):', CORRECT_FINAL);
    console.log('Expected (+=   / buggy)     :', BUGGY_FINAL);
    console.log('---------------------------\n');

    // This assertion uses the CORRECT expected value.
    // If the bug exists, this assertion FAILS and the test is RED.
    // If the code already handles it correctly, this assertion PASSES.
    expect(usageEvents).toHaveLength(3); // one yield per usage-bearing chunk
    expect(lastEvent).toEqual(CORRECT_FINAL);
  });

  // -------------------------------------------------------------------------
  // Test 3 — Null-guard: usage chunks with null values are skipped cleanly
  // Confirms the `|| 0` fallback doesn't mask the bug for partial fields.
  // -------------------------------------------------------------------------
  it('[null-guard] intermediate chunks with null usage are skipped', async () => {
    const chunks = [
      { choices: [{ delta: { content: 'Hi' } }], usage: null },
      { choices: [{ delta: { content: '!' } }], usage: null },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
    ];

    const usageEvents = await collectUsageEvents(service, chunks);

    // Only one event — the null chunks must not trigger a yield.
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual({ promptTokens: 5, completionTokens: 2, totalTokens: 7 });
  });

  // -------------------------------------------------------------------------
  // Test 4 — Edge case: single usage chunk with partial fields (some undefined)
  // The `|| 0` fallback must not corrupt the final tally.
  // -------------------------------------------------------------------------
  it('[edge-case] partial usage fields (undefined) default to 0', async () => {
    const chunks = [
      // Provider sends a chunk where some fields are absent (e.g. no reasoning_tokens split)
      { choices: [], usage: { prompt_tokens: 8, completion_tokens: undefined, total_tokens: 8 } },
    ];

    const usageEvents = await collectUsageEvents(service, chunks);

    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toEqual({ promptTokens: 8, completionTokens: 0, totalTokens: 8 });
  });
});
