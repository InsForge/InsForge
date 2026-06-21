import { beforeEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.stubGlobal('fetch', mockFetch);

import {
  compressMessages,
  isCompressionEnabled,
} from '../../src/services/ai/prompt-compression.service';
import { appConfig } from '../../src/infra/config/app.config';

type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

// ~9600 chars, comfortably over the default 6000-char request gate.
const bigText = 'lorem ipsum dolor sit amet '.repeat(360);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) };
}

describe('prompt-compression connector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appConfig.ai.compressionUrl = undefined;
    appConfig.ai.compressionTimeoutMs = 2000;
    appConfig.ai.compressionMinChars = 6000;
  });

  it('is a no-op (no fetch) when no sidecar URL is configured', async () => {
    const messages: ChatMessage[] = [{ role: 'user', content: bigText }];

    const out = await compressMessages(messages);

    expect(isCompressionEnabled()).toBe(false);
    expect(out).toBe(messages);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips the sidecar for requests below the size gate', async () => {
    appConfig.ai.compressionUrl = 'http://sidecar:8459';
    const messages: ChatMessage[] = [{ role: 'user', content: 'short prompt' }];

    const out = await compressMessages(messages);

    expect(out).toBe(messages);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the sidecar-compressed messages on success and calls /compress', async () => {
    appConfig.ai.compressionUrl = 'http://sidecar:8459/'; // trailing slash trimmed
    const messages: ChatMessage[] = [
      { role: 'system', content: bigText },
      { role: 'user', content: bigText },
    ];
    const compressed: ChatMessage[] = [
      { role: 'system', content: 'compressed system' },
      { role: 'user', content: 'compressed user' },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ messages: compressed }));

    const out = await compressMessages(messages);

    expect(out).toEqual(compressed);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://sidecar:8459/compress');
    expect(JSON.parse(init.body as string)).toEqual({ messages });
  });

  it('falls back to the original messages on a non-OK status', async () => {
    appConfig.ai.compressionUrl = 'http://sidecar:8459';
    const messages: ChatMessage[] = [{ role: 'user', content: bigText }];
    mockFetch.mockResolvedValueOnce(jsonResponse({}, false, 503));

    const out = await compressMessages(messages);

    expect(out).toBe(messages);
  });

  it('fails open when the sidecar throws or times out', async () => {
    appConfig.ai.compressionUrl = 'http://sidecar:8459';
    const messages: ChatMessage[] = [{ role: 'user', content: bigText }];
    mockFetch.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

    const out = await compressMessages(messages);

    expect(out).toBe(messages);
  });

  it('discards a response whose message count does not match the input', async () => {
    appConfig.ai.compressionUrl = 'http://sidecar:8459';
    const messages: ChatMessage[] = [
      { role: 'user', content: bigText },
      { role: 'assistant', content: bigText },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ messages: [{ role: 'user', content: 'only one' }] }));

    const out = await compressMessages(messages);

    expect(out).toBe(messages);
  });
});
