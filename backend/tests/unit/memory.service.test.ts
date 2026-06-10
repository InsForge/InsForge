import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, embedMock, chatMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  embedMock: vi.fn(),
  chatMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({ getPool: vi.fn(() => ({ query: poolQueryMock })) })),
  },
}));
vi.mock('../../src/services/ai/embedding.service', () => ({
  EmbeddingService: { getInstance: vi.fn(() => ({ createEmbeddings: embedMock })) },
}));
vi.mock('../../src/services/ai/chat-completion.service', () => ({
  ChatCompletionService: { getInstance: vi.fn(() => ({ chat: chatMock })) },
}));

import { MemoryService } from '../../src/services/memory/memory.service';

// Route pool.query by SQL shape so each test controls the "similar" rows.
let similarRows: Array<{ id: string; kind: string; title: string; content: string; similarity: number }> = [];
function installPool() {
  poolQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO memory.memories')) return { rows: [{ id: 'new-id-0000' }] };
    if (sql.includes('UPDATE memory.memories')) return { rows: [] };
    if (sql.includes('WITH q AS')) return { rows: [] }; // recall (overridden per-test)
    if (sql.includes('ORDER BY updated_at DESC')) return { rows: [] }; // index
    return { rows: similarRows }; // findSimilar
  });
}

const service = MemoryService.getInstance();

beforeEach(() => {
  vi.clearAllMocks();
  similarRows = [];
  embedMock.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
  installPool();
});

describe('MemoryService.remember — reconcile', () => {
  it('ADDs a new memory when nothing similar exists', async () => {
    const res = await service.remember({ scope: 's', kind: 'fact', title: 't', content: 'c' });
    expect(res).toEqual([{ action: 'ADD', id: 'new-id-0000', title: 't' }]);
    expect(poolQueryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(true);
  });

  it('NOOPs when the reconciler says the fact is already known', async () => {
    similarRows = [{ id: 'a1', kind: 'fact', title: 'x', content: 'y', similarity: 0.9 }];
    chatMock.mockResolvedValue({ text: '{"action":"NOOP"}' });
    const res = await service.remember({ scope: 's', kind: 'fact', title: 't', content: 'c' });
    expect(res[0].action).toBe('NOOP');
    expect(poolQueryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(false);
  });

  it('UPDATEs in place (and sets kind) when the reconciler targets a real matched id', async () => {
    const matchId = '11111111-1111-4111-8111-111111111111';
    similarRows = [{ id: matchId, kind: 'fact', title: 'old', content: 'old', similarity: 0.8 }];
    chatMock.mockResolvedValue({
      text: `{"action":"UPDATE","target_id":"${matchId}","title":"new","content":"new merged"}`,
    });
    const res = await service.remember({ scope: 's', kind: 'decision', title: 't', content: 'c' });
    expect(res[0]).toEqual({ action: 'UPDATE', id: matchId, title: 'new' });
    const updateCall = poolQueryMock.mock.calls.find(([sql]) => String(sql).includes('UPDATE memory.memories'));
    expect(updateCall).toBeDefined();
    expect(updateCall![1][0]).toBe('decision'); // kind is updated, not retained
  });

  it('falls back to ADD when the reconciler returns a hallucinated target_id', async () => {
    similarRows = [{ id: 'a1', kind: 'fact', title: 'old', content: 'old', similarity: 0.8 }];
    chatMock.mockResolvedValue({ text: '{"action":"UPDATE","target_id":"does-not-exist"}' });
    const res = await service.remember({ scope: 's', kind: 'fact', title: 't', content: 'c' });
    expect(res[0].action).toBe('ADD');
    expect(poolQueryMock.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))).toBe(true);
  });
});

describe('MemoryService.remember — extraction sanitization & failure isolation', () => {
  it('coerces an invalid kind to fact and drops candidates missing title/content', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({
        memories: [
          { kind: 'banana', title: 'keep me', content: 'valid' }, // bad kind -> fact
          { kind: 'fact', title: '', content: 'no title' }, // dropped
          { kind: 'fact', title: 'no content', content: '' }, // dropped
        ],
      }),
    });
    const res = await service.remember({ scope: 's', transcript: 'some transcript' });
    expect(res).toHaveLength(1);
    expect(res[0].title).toBe('keep me');
    const insert = poolQueryMock.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO'));
    expect(insert![1][1]).toBe('fact'); // coerced kind
  });

  it('isolates a per-candidate failure without discarding the rest', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({
        memories: [
          { kind: 'fact', title: 'good', content: 'a' },
          { kind: 'fact', title: 'bad', content: 'b' },
        ],
      }),
    });
    embedMock
      .mockResolvedValueOnce({ data: [{ embedding: [0.1] }] }) // candidate 1 ok
      .mockRejectedValueOnce(new Error('embed boom')); // candidate 2 fails
    const res = await service.remember({ scope: 's', transcript: 't' });
    expect(res).toHaveLength(2);
    expect(res[0].action).toBe('ADD');
    expect(res[1]).toEqual({ action: 'NOOP', title: 'bad' });
  });
});

describe('MemoryService.recall / index', () => {
  it('maps recall rows and normalizes the date', async () => {
    poolQueryMock.mockImplementationOnce(async () => ({
      rows: [
        {
          id: 'r1',
          kind: 'fact',
          title: 'T',
          content: 'C',
          similarity: 0.71,
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    }));
    const res = await service.recall({ scope: 's', query: 'q', limit: 5 });
    expect(res[0]).toMatchObject({ id: 'r1', similarity: 0.71 });
    expect(res[0].updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns the title index for a scope', async () => {
    poolQueryMock.mockImplementationOnce(async () => ({
      rows: [{ id: 'i1', kind: 'decision', title: 'D', updated_at: new Date('2026-02-02T00:00:00Z') }],
    }));
    const res = await service.index('s');
    expect(res).toEqual([
      { id: 'i1', kind: 'decision', title: 'D', updated_at: '2026-02-02T00:00:00.000Z' },
    ]);
  });
});
