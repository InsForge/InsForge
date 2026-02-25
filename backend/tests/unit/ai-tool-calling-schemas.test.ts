import { describe, it, expect } from 'vitest';
import {
  toolFunctionSchema,
  toolSchema,
  toolChoiceSchema,
  toolCallSchema,
  chatMessageSchema,
  chatCompletionRequestSchema,
  chatCompletionResponseSchema,
} from '@insforge/shared-schemas';

describe('Tool Calling Schemas', () => {
  describe('toolFunctionSchema', () => {
    it('accepts a valid function definition with all fields', () => {
      const result = toolFunctionSchema.safeParse({
        name: 'get_weather',
        description: 'Get current weather for a city',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal function definition (name only)', () => {
      const result = toolFunctionSchema.safeParse({ name: 'do_something' });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = toolFunctionSchema.safeParse({ description: 'no name' });
      expect(result.success).toBe(false);
    });
  });

  describe('toolSchema', () => {
    it('accepts a valid tool', () => {
      const result = toolSchema.safeParse({
        type: 'function',
        function: { name: 'get_weather' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid type', () => {
      const result = toolSchema.safeParse({
        type: 'invalid',
        function: { name: 'get_weather' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('toolChoiceSchema', () => {
    it('accepts string values', () => {
      expect(toolChoiceSchema.safeParse('auto').success).toBe(true);
      expect(toolChoiceSchema.safeParse('none').success).toBe(true);
      expect(toolChoiceSchema.safeParse('required').success).toBe(true);
    });

    it('rejects invalid string value', () => {
      expect(toolChoiceSchema.safeParse('invalid').success).toBe(false);
    });

    it('accepts specific function choice', () => {
      const result = toolChoiceSchema.safeParse({
        type: 'function',
        function: { name: 'get_weather' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('toolCallSchema', () => {
    it('accepts a valid tool call', () => {
      const result = toolCallSchema.safeParse({
        id: 'call_abc123',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Tokyo"}',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing id', () => {
      const result = toolCallSchema.safeParse({
        type: 'function',
        function: { name: 'get_weather', arguments: '{}' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('chatMessageSchema - tool role support', () => {
    it('accepts tool role message', () => {
      const result = chatMessageSchema.safeParse({
        role: 'tool',
        content: '{"temp":"22°C"}',
        tool_call_id: 'call_abc123',
      });
      expect(result.success).toBe(true);
    });

    it('accepts assistant message with tool_calls', () => {
      const result = chatMessageSchema.safeParse({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts nullable content', () => {
      const result = chatMessageSchema.safeParse({
        role: 'assistant',
        content: null,
      });
      expect(result.success).toBe(true);
    });

    it('still accepts regular messages without tool fields', () => {
      const result = chatMessageSchema.safeParse({
        role: 'user',
        content: 'Hello',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('chatCompletionRequestSchema - tool fields', () => {
    const baseRequest = {
      model: 'openai/gpt-4',
      messages: [{ role: 'user' as const, content: 'Hello' }],
    };

    it('accepts request with tools', () => {
      const result = chatCompletionRequestSchema.safeParse({
        ...baseRequest,
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('accepts request with tool_choice', () => {
      const result = chatCompletionRequestSchema.safeParse({
        ...baseRequest,
        tool_choice: 'auto',
      });
      expect(result.success).toBe(true);
    });

    it('accepts request with parallel_tool_calls', () => {
      const result = chatCompletionRequestSchema.safeParse({
        ...baseRequest,
        parallel_tool_calls: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts request without any tool fields (backward compatible)', () => {
      const result = chatCompletionRequestSchema.safeParse(baseRequest);
      expect(result.success).toBe(true);
    });
  });

  describe('chatCompletionResponseSchema - tool_calls', () => {
    it('accepts response with tool_calls', () => {
      const result = chatCompletionResponseSchema.safeParse({
        text: '',
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' },
          },
        ],
        metadata: { model: 'openai/gpt-4' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts response without tool_calls (backward compatible)', () => {
      const result = chatCompletionResponseSchema.safeParse({
        text: 'Hello!',
        metadata: { model: 'openai/gpt-4' },
      });
      expect(result.success).toBe(true);
    });
  });
});
