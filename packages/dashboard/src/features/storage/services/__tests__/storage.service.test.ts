import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  getAccessToken: vi.fn(() => 'token'),
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

import { storageService } from '#features/storage/services/storage.service';

const mockBucket = 'test-bucket';
const mockFile = new File(['hello world'], 'readme.txt', { type: 'text/plain' });

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(response: Partial<Response> = {}) {
  const defaultHeaders = new Headers({ 'content-type': 'application/json' });
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: defaultHeaders,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
    ...response,
  } as Response);
}

describe('storageService.uploadObject', () => {
  it('uploads via direct strategy when the backend returns method=direct', async () => {
    const strategyUrl = `/api/storage/buckets/${mockBucket}/objects/readme.txt`;
    const storedFile = { key: 'readme.txt', bucket: mockBucket, size: 11 };

    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'direct',
          uploadUrl: strategyUrl,
          key: 'readme.txt',
          confirmRequired: false,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(storedFile),
      } as unknown as Response);

    const result = await storageService.uploadObject(mockBucket, 'readme.txt', mockFile);

    expect(result).toMatchObject(storedFile);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const strategyCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(strategyCall[0]).toContain('/upload-strategy');
    expect(strategyCall[1]?.method).toBe('POST');

    const uploadCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(uploadCall[0]).toBe(strategyUrl);
    expect(uploadCall[1]?.method).toBe('PUT');
  });

  it('uses presigned strategy and confirms when backend returns method=presigned', async () => {
    const presignedUrl = 'https://s3.example.com/presigned-upload';
    const confirmUrl = `/api/storage/buckets/${mockBucket}/objects/readme.txt/confirm-upload`;
    const storedFile = { key: 'readme.txt', bucket: mockBucket, size: 11 };

    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'presigned',
          uploadUrl: presignedUrl,
          fields: { key: 'readme.txt', 'X-Amz-Credential': 'abc/2024' },
          key: 'readme.txt',
          confirmRequired: true,
          confirmUrl,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-type': 'application/xml', etag: '"etag123"' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue(storedFile),
      } as unknown as Response);

    const result = await storageService.uploadObject(mockBucket, 'readme.txt', mockFile);

    expect(result).toMatchObject(storedFile);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);

    const presignedCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(presignedCall[0]).toBe(presignedUrl);
    expect(presignedCall[1]?.method).toBe('POST');

    const confirmCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[2];
    expect(confirmCall[0]).toBe(confirmUrl);
    expect(confirmCall[1]?.method).toBe('POST');
    const confirmBody = JSON.parse((confirmCall[1] as RequestInit).body as string);
    expect(confirmBody).toMatchObject({
      size: 11,
      contentType: 'text/plain',
    });
  });

  it('extracts error message from JSON error responses', async () => {
    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'direct',
          uploadUrl: '/upload',
          key: 'readme.txt',
          confirmRequired: false,
        }),
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            method: 'direct',
            uploadUrl: '/upload',
            key: 'readme.txt',
            confirmRequired: false,
          })
        ),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            error: 'STORAGE_INVALID_PARAMETER',
            message: 'File too large. Maximum upload size is 50 MB.',
            statusCode: 413,
          })
        ),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'File too large. Maximum upload size is 50 MB.'
    );
  });

  it('strips HTML tags from HTML error responses', async () => {
    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'direct',
          uploadUrl: '/upload',
          key: 'readme.txt',
          confirmRequired: false,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Payload Too Large',
        headers: new Headers({ 'content-type': 'text/html' }),
        json: vi
          .fn()
          .mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0')),
        text: vi
          .fn()
          .mockResolvedValue('<html><body><h1>413 Request Entity Too Large</h1></body></html>'),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      '413 Request Entity Too Large'
    );
  });

  it('extracts Message tag from S3 XML error responses', async () => {
    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'presigned',
          uploadUrl: 'https://s3.example.com/upload',
          fields: { key: 'readme.txt' },
          key: 'readme.txt',
          confirmRequired: true,
          confirmUrl: '/confirm',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: 'Request Entity Too Large',
        headers: new Headers({ 'content-type': 'application/xml' }),
        json: vi.fn().mockRejectedValue(new SyntaxError('Not JSON')),
        text: vi
          .fn()
          .mockResolvedValue(
            '<Error><Code>EntityTooLarge</Code><Message>Your proposed upload exceeds the maximum allowed object size.</Message></Error>'
          ),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'Your proposed upload exceeds the maximum allowed object size.'
    );
  });

  it('falls back to statusText when XML has no Message tag', async () => {
    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'presigned',
          uploadUrl: 'https://s3.example.com/upload',
          fields: { key: 'readme.txt' },
          key: 'readme.txt',
          confirmRequired: true,
          confirmUrl: '/confirm',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({ 'content-type': 'application/xml' }),
        json: vi.fn().mockRejectedValue(new SyntaxError('Not JSON')),
        text: vi.fn().mockResolvedValue('<Error><Code>AccessDenied</Code></Error>'),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'Forbidden'
    );
  });

  it('handles presigned strategy with confirmRequired: false gracefully', async () => {
    const presignedUrl = 'https://s3.example.com/presigned-upload';

    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'presigned',
          uploadUrl: presignedUrl,
          fields: { key: 'readme.txt' },
          key: 'readme.txt',
          confirmRequired: false,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-type': 'application/xml' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response);

    const result = await storageService.uploadObject(mockBucket, 'readme.txt', mockFile);

    expect(result).toMatchObject({
      key: 'readme.txt',
      bucket: mockBucket,
      size: 11,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to text when JSON content-type body is malformed', async () => {
    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'direct',
          uploadUrl: '/upload',
          key: 'readme.txt',
          confirmRequired: false,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
        text: vi.fn().mockResolvedValue('Bad Gateway'),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'Bad Gateway'
    );
  });

  it('throws a meaningful error when the strategy endpoint itself fails', async () => {
    mockFetch().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'text/plain' }),
      json: vi.fn().mockRejectedValue(new SyntaxError('Not JSON')),
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'Internal Server Error'
    );
  });

  it('throws a meaningful error when the confirm endpoint fails', async () => {
    const presignedUrl = 'https://s3.example.com/presigned-upload';
    const confirmUrl = `/api/storage/buckets/${mockBucket}/objects/readme.txt/confirm-upload`;

    mockFetch()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: vi.fn().mockResolvedValue({
          method: 'presigned',
          uploadUrl: presignedUrl,
          fields: { key: 'readme.txt' },
          key: 'readme.txt',
          confirmRequired: true,
          confirmUrl,
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-type': 'application/xml' }),
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
        text: vi.fn().mockResolvedValue(''),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: vi.fn().mockRejectedValue(new SyntaxError('Not JSON')),
        text: vi.fn().mockResolvedValue('Upload already confirmed'),
      } as unknown as Response);

    await expect(storageService.uploadObject(mockBucket, 'readme.txt', mockFile)).rejects.toThrow(
      'Upload already confirmed'
    );
  });
});

describe('storageService.deleteObjects', () => {
  beforeEach(() => {
    apiClientMock.request.mockReset();
    apiClientMock.withAccessToken.mockClear();
  });

  it('deletes objects with one batch DELETE request', async () => {
    apiClientMock.request.mockResolvedValue({
      results: [
        { key: 'a.txt', status: 'deleted' },
        { key: 'missing.txt', status: 'notFound' },
        { key: 'blocked.txt', status: 'failed', message: 'Access denied' },
      ],
    });

    const result = await storageService.deleteObjects('photos', [
      'a.txt',
      'missing.txt',
      'blocked.txt',
    ]);

    expect(apiClientMock.request).toHaveBeenCalledWith('/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: ['a.txt', 'missing.txt', 'blocked.txt'] }),
    });
    expect(result.success).toEqual(['a.txt']);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]).toMatchObject({
      key: 'missing.txt',
      error: new Error('Object not found'),
    });
    expect(result.failures[1]).toMatchObject({
      key: 'blocked.txt',
      error: new Error('Access denied'),
    });
  });

  it('does not call the API for an empty delete list', async () => {
    await expect(storageService.deleteObjects('photos', [])).resolves.toEqual({
      success: [],
      failures: [],
    });

    expect(apiClientMock.request).not.toHaveBeenCalled();
  });

  it('chunks deletes into batches of 1000 objects', async () => {
    apiClientMock.request
      .mockResolvedValueOnce({
        results: Array.from({ length: 1000 }, (_, index) => ({
          key: `file-${index}.txt`,
          status: 'deleted',
        })),
      })
      .mockResolvedValueOnce({
        results: [{ key: 'file-1000.txt', status: 'deleted' }],
      });
    const keys = Array.from({ length: 1001 }, (_, index) => `file-${index}.txt`);

    const result = await storageService.deleteObjects('photos', keys);

    expect(result).toEqual({ success: keys, failures: [] });
    expect(apiClientMock.request).toHaveBeenCalledTimes(2);
    expect(apiClientMock.request).toHaveBeenNthCalledWith(1, '/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: keys.slice(0, 1000) }),
    });
    expect(apiClientMock.request).toHaveBeenNthCalledWith(2, '/storage/buckets/photos/objects', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
      body: JSON.stringify({ keys: ['file-1000.txt'] }),
    });
  });

  it('returns structured failures when a batch request fails', async () => {
    apiClientMock.request.mockRejectedValue(new Error('HTTP 500'));

    const result = await storageService.deleteObjects('photos', ['a.txt', 'b.txt']);

    expect(result.success).toEqual([]);
    expect(result.failures).toEqual([
      { key: 'a.txt', error: new Error('HTTP 500') },
      { key: 'b.txt', error: new Error('HTTP 500') },
    ]);
  });
});
