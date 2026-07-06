import { Readable } from 'stream';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toXml } from '@/api/routes/s3-gateway/xml.js';
import { sendS3Error, S3ProtocolError } from '@/api/routes/s3-gateway/errors.js';
import { normalizeArrayField } from '@/api/routes/s3-gateway/commands/put-bucket-cors.js';
import { StorageService } from '@/services/storage/storage.service.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// CORS XML output format
// ---------------------------------------------------------------------------
describe('CORS XML output format', () => {
  it('builds a single CORSRule XML', () => {
    const xml = toXml({
      CORSConfiguration: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        CORSRule: {
          AllowedOrigin: ['https://example.com'],
          AllowedMethod: ['GET', 'PUT'],
          AllowedHeader: ['*'],
          ExposeHeader: ['x-amz-request-id'],
          MaxAgeSeconds: 3600,
        },
      },
    });
    expect(xml).toContain('<CORSConfiguration');
    expect(xml).toContain('<CORSRule>');
    expect(xml).toContain('<AllowedOrigin>https://example.com</AllowedOrigin>');
    expect(xml).toContain('<AllowedMethod>GET</AllowedMethod>');
    expect(xml).toContain('<AllowedMethod>PUT</AllowedMethod>');
    expect(xml).toContain('<MaxAgeSeconds>3600</MaxAgeSeconds>');
  });

  it('builds multiple CORSRule XML', () => {
    const xml = toXml({
      CORSConfiguration: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        CORSRule: [
          { AllowedOrigin: ['https://a.com'], AllowedMethod: ['GET'] },
          { AllowedOrigin: ['https://b.com'], AllowedMethod: ['POST'] },
        ],
      },
    });
    expect(xml).toContain('<CORSConfiguration');
    const matches = xml.match(/<CORSRule>/g);
    expect(matches).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// normalizeArrayField
// ---------------------------------------------------------------------------
describe('normalizeArrayField', () => {
  it('converts a single string to a single-element array', () => {
    expect(normalizeArrayField('GET')).toEqual(['GET']);
  });

  it('converts a non-array value to a single-element string array', () => {
    const result = normalizeArrayField(42);
    expect(result).toEqual(['42']);
    expect(result).toHaveLength(1);
  });

  it('maps each element of an array to strings', () => {
    expect(normalizeArrayField(['GET', 'PUT', 'POST'])).toEqual(['GET', 'PUT', 'POST']);
  });

  it('returns empty array for null', () => {
    expect(normalizeArrayField(null)).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(normalizeArrayField(undefined)).toEqual([]);
  });

  it('coerces non-string array elements to strings', () => {
    expect(normalizeArrayField([1, 2])).toEqual(['1', '2']);
  });
});

// ---------------------------------------------------------------------------
// Empty CORS configuration rejection
// ---------------------------------------------------------------------------
describe('PutBucketCors — empty CORS config rejection', () => {
  it('rejects CORSConfiguration with no CORSRule via MalformedXML', async () => {
    const svc = StorageService.getInstance();
    vi.spyOn(svc, 'bucketExists').mockResolvedValue(true);

    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const res = { status, type, send } as unknown as import('express').Response;

    const body = '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>';
    const req = Object.assign(Readable.from([Buffer.from(body)]), {
      s3Bucket: 'test-bucket',
      s3Key: null,
      s3Op: 'PutBucketCors',
      s3Auth: { requestId: 'test-req' },
      path: '/test-bucket?cors',
    });

    const { handle } = await import('@/api/routes/s3-gateway/commands/put-bucket-cors.js');
    await handle(req as never, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(send.mock.calls[0][0] as string).toContain('MalformedXML');
    expect(send.mock.calls[0][0] as string).toContain(
      'CORSConfiguration must contain at least one CORSRule'
    );
  });
});

// ---------------------------------------------------------------------------
// NoSuchCORSConfiguration error code
// ---------------------------------------------------------------------------
describe('NoSuchCORSConfiguration error', () => {
  it('S3ProtocolError throws with correct code', () => {
    const err = new S3ProtocolError(
      'NoSuchCORSConfiguration',
      'The CORS configuration does not exist'
    );
    expect(err.code).toBe('NoSuchCORSConfiguration');
    expect(err.message).toBe('The CORS configuration does not exist');
  });

  it('sendS3Error maps to 404', () => {
    const status = vi.fn().mockReturnThis();
    const type = vi.fn().mockReturnThis();
    const send = vi.fn();
    const res = { status, type, send } as unknown as import('express').Response;

    sendS3Error(res, 'NoSuchCORSConfiguration', 'The CORS configuration does not exist', {
      resource: '/bucket',
      requestId: 'req-123',
    });

    expect(status).toHaveBeenCalledWith(404);
    expect(type).toHaveBeenCalledWith('application/xml');
    const xml = send.mock.calls[0][0] as string;
    expect(xml).toContain('NoSuchCORSConfiguration');
    expect(xml).toContain('The CORS configuration does not exist');
  });
});

// ---------------------------------------------------------------------------
// Tagging XML output format
// ---------------------------------------------------------------------------
describe('Tagging XML output format', () => {
  it('builds a single tag XML', () => {
    const xml = toXml({
      Tagging: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        TagSet: {
          Tag: { Key: 'env', Value: 'test' },
        },
      },
    });
    expect(xml).toContain('<Tagging');
    expect(xml).toContain('<Tag>');
    expect(xml).toContain('<Key>env</Key>');
    expect(xml).toContain('<Value>test</Value>');
  });

  it('builds multiple tags XML', () => {
    const xml = toXml({
      Tagging: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        TagSet: {
          Tag: [
            { Key: 'env', Value: 'test' },
            { Key: 'owner', Value: 'ci' },
          ],
        },
      },
    });
    const tagMatches = xml.match(/<Tag>/g);
    expect(tagMatches).toHaveLength(2);
    expect(xml).toContain('<Key>owner</Key>');
  });

  it('builds empty tag set XML', () => {
    const xml = toXml({
      Tagging: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        TagSet: {},
      },
    });
    expect(xml).toContain('<Tagging');
    expect(xml).toContain('<TagSet/>');
  });
});

// ---------------------------------------------------------------------------
// Versioning XML output format
// ---------------------------------------------------------------------------
describe('Versioning XML output format', () => {
  it('builds Enabled status XML', () => {
    const xml = toXml({
      VersioningConfiguration: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        Status: 'Enabled',
      },
    });
    expect(xml).toContain('<VersioningConfiguration');
    expect(xml).toContain('<Status>Enabled</Status>');
  });

  it('builds Suspended status XML', () => {
    const xml = toXml({
      VersioningConfiguration: {
        $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
        Status: 'Suspended',
      },
    });
    expect(xml).toContain('<Status>Suspended</Status>');
  });
});

// ---------------------------------------------------------------------------
// Service method signatures (interface contract tests)
// ---------------------------------------------------------------------------
describe('StorageService S3 extension method contract', () => {
  let svc: StorageService;

  beforeEach(() => {
    svc = StorageService.getInstance();
  });

  it('getBucketCorsRules exists', () => {
    expect(typeof svc.getBucketCorsRules).toBe('function');
  });

  it('putBucketCorsRules exists', () => {
    expect(typeof svc.putBucketCorsRules).toBe('function');
  });

  it('deleteBucketCorsRules exists', () => {
    expect(typeof svc.deleteBucketCorsRules).toBe('function');
  });

  it('getObjectTags exists', () => {
    expect(typeof svc.getObjectTags).toBe('function');
  });

  it('putObjectTags exists', () => {
    expect(typeof svc.putObjectTags).toBe('function');
  });

  it('deleteObjectTags exists', () => {
    expect(typeof svc.deleteObjectTags).toBe('function');
  });

  it('getBucketVersioningStatus exists', () => {
    expect(typeof svc.getBucketVersioningStatus).toBe('function');
  });

  it('putBucketVersioningStatus exists', () => {
    expect(typeof svc.putBucketVersioningStatus).toBe('function');
  });
});
