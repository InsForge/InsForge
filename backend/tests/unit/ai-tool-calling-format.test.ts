import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessageSchema } from '@insforge/shared-schemas';

// Mock dependencies before importing the service
vi.mock('../../src/services/ai/ai-usage.service.js', () => ({
  AIUsageService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/ai/ai-config.service.js', () => ({
  AIConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({}) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('ChatCompletionService - formatMessages', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  beforeEach(async () => {
    const mod = await import('../../src/services/ai/chat-completion.service.js');
    service = mod.ChatCompletionService.getInstance();
  });

  it('formats tool role messages with tool_call_id', () => {
    const messages: ChatMessageSchema[] = [
      {
        role: 'tool',
        content: '{"temp":"22°C"}',
        tool_call_id: 'call_abc123',
      },
    ];

    const result = service.formatMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'tool',
      content: '{"temp":"22°C"}',
      tool_call_id: 'call_abc123',
    });
  });

  it('formats assistant messages with tool_calls', () => {
    const messages: ChatMessageSchema[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          },
        ],
      },
    ];

    const result = service.formatMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBeNull();
    expect(result[0].tool_calls).toEqual([
      {
        id: 'call_abc123',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
      },
    ]);
  });

  it('formats regular user messages unchanged', () => {
    const messages: ChatMessageSchema[] = [{ role: 'user', content: 'Hello' }];

    const result = service.formatMessages(messages);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
  });

  it('prepends system prompt when provided', () => {
    const messages: ChatMessageSchema[] = [{ role: 'user', content: 'Hi' }];

    const result = service.formatMessages(messages, 'You are helpful.');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('handles a full multi-turn tool calling conversation', () => {
    const messages: ChatMessageSchema[] = [
      { role: 'user', content: 'What is the weather in Tokyo?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"temp":"22°C","condition":"sunny"}',
        tool_call_id: 'call_1',
      },
    ];

    const result = service.formatMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
    expect(result[1].tool_calls).toBeDefined();
    expect(result[2].role).toBe('tool');
    expect(result[2].tool_call_id).toBe('call_1');
  });

  it('handles tool message with empty tool_call_id', () => {
    const messages: ChatMessageSchema[] = [
      {
        role: 'tool',
        content: 'result',
      },
    ];

    const result = service.formatMessages(messages);

    expect(result[0].role).toBe('tool');
    expect(result[0].tool_call_id).toBe('');
  });
});
