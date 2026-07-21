import { describe, it, expect, vi, beforeEach } from 'vitest';
import type OpenAI from 'openai';
import type { ChatMessageSchema } from '@insforge/shared-schemas';

// Shared mock for the OpenRouter provider's sendRequest. Hoisted so the vi.mock
// factory (itself hoisted above the imports) can close over it.
const { sendRequestMock } = vi.hoisted(() => ({ sendRequestMock: vi.fn() }));

vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({ sendRequest: sendRequestMock }) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

type StreamingRequest = OpenAI.Chat.ChatCompletionCreateParamsStreaming;

// Minimal async-iterable stream of OpenRouter/OpenAI streaming chunks.
async function* fakeStream(chunks: unknown[]): AsyncGenerator<unknown> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Wire sendRequest so the service's callback runs against a fake OpenAI client,
// returning the given chunks. Exposes the request payload the service passed to
// `client.chat.completions.create` so tests can assert on it.
function mockStream(chunks: unknown[]): { request?: StreamingRequest } {
  const captured: { request?: StreamingRequest } = {};
  sendRequestMock.mockImplementation(async (fn: (client: unknown) => unknown) => {
    const client = {
      chat: {
        completions: {
          create: (request: StreamingRequest) => {
            captured.request = request;
            return fakeStream(chunks);
          },
        },
      },
    };
    return { result: await fn(client), source: 'env' };
  });
  return captured;
}

describe('ChatCompletionService.streamChat - token usage accounting', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(async () => {
    sendRequestMock.mockReset();
    const mod = await import('../../src/services/ai/chat-completion.service.js');
    service = mod.ChatCompletionService.getInstance();
  });

  it('opts in to usage accounting via stream_options.include_usage', async () => {
    const captured = mockStream([{ choices: [{ delta: { content: 'Hi' } }] }]);

    // Drain the generator so the request is issued.
    for await (const _event of service.streamChat(
      [{ role: 'user', content: 'Hello' }] as ChatMessageSchema[],
      { model: 'openai/gpt-4o' }
    )) {
      void _event;
    }

    // Regression guard: without stream_options.include_usage, OpenRouter omits the
    // usage chunk entirely and streamed requests report zero token usage.
    expect(captured.request?.stream).toBe(true);
    expect(captured.request?.stream_options).toEqual({ include_usage: true });
  });

  it('emits token usage from the final usage-only chunk', async () => {
    mockStream([
      { choices: [{ delta: { content: 'Hello ' } }] },
      { choices: [{ delta: { content: 'world' } }] },
      // Final chunk carries the totals with an empty choices array (OpenAI/OpenRouter shape).
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } },
    ]);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of service.streamChat(
      [{ role: 'user', content: 'Hi' }] as ChatMessageSchema[],
      { model: 'openai/gpt-4o' }
    )) {
      events.push(event);
    }

    // With include_usage the provider emits exactly one usage-bearing chunk (the
    // final one); intermediate chunks carry `usage: null`. Assert a single event
    // so a regression that double-counts usage across chunks would be caught.
    const usageEvents = events.filter((event) => event.tokenUsage);
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0].tokenUsage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      totalTokens: 20,
    });
  });
});
