import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  buildCanonicalRequest,
  sha256Hex,
  deriveSigningKey,
  buildStringToSign,
  verifyHeaderSignature,
} from '@/services/storage/s3-signature.js';

describe('buildCanonicalRequest', () => {
  it('produces AWS test-suite canonical form for simple GET', () => {
    const canonical = buildCanonicalRequest({
      method: 'GET',
      path: '/',
      query: '',
      headers: {
        host: 'example.amazonaws.com',
        'x-amz-date': '20150830T123600Z',
      },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    expect(canonical).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n')
    );
  });

  it('URI-encodes object key with spaces', () => {
    const canonical = buildCanonicalRequest({
      method: 'PUT',
      path: '/my-bucket/photos/sun set.jpg',
      query: '',
      headers: { host: 'h', 'x-amz-date': '20260101T000000Z' },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'UNSIGNED-PAYLOAD',
    });
    expect(canonical.split('\n')[1]).toBe('/my-bucket/photos/sun%20set.jpg');
  });

  it('does not double-encode an already-encoded path', () => {
    // Callers may pass either a decoded path ("sun set.jpg") or the raw
    // encoded form from the wire ("sun%20set.jpg"). Both must canonicalize
    // to the same string, never "sun%2520set.jpg".
    const canonical = buildCanonicalRequest({
      method: 'PUT',
      path: '/my-bucket/photos/sun%20set.jpg',
      query: '',
      headers: { host: 'h', 'x-amz-date': '20260101T000000Z' },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'UNSIGNED-PAYLOAD',
    });
    expect(canonical.split('\n')[1]).toBe('/my-bucket/photos/sun%20set.jpg');
  });

  it('sorts query parameters and encodes + as literal per SigV4 spec', () => {
    const canonical = buildCanonicalRequest({
      method: 'GET',
      path: '/my-bucket',
      query: 'prefix=foo+bar&list-type=2',
      headers: { host: 'h', 'x-amz-date': '20260101T000000Z' },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'UNSIGNED-PAYLOAD',
    });
    // SigV4: only %20 is a space; '+' is a literal '+' and must re-encode to %2B.
    expect(canonical.split('\n')[2]).toBe('list-type=2&prefix=foo%2Bbar');
  });

  it('decodes %20 and re-encodes as %20 in query values', () => {
    const canonical = buildCanonicalRequest({
      method: 'GET',
      path: '/my-bucket',
      query: 'prefix=foo%20bar',
      headers: { host: 'h', 'x-amz-date': '20260101T000000Z' },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'UNSIGNED-PAYLOAD',
    });
    expect(canonical.split('\n')[2]).toBe('prefix=foo%20bar');
  });

  it('trims whitespace in header values for canonical header block', () => {
    const canonical = buildCanonicalRequest({
      method: 'GET',
      path: '/',
      query: '',
      headers: { Host: 'Example.com  ', 'X-Amz-Date': '20260101T000000Z' },
      signedHeaders: ['host', 'x-amz-date'],
      payloadHash: 'UNSIGNED-PAYLOAD',
    });
    expect(canonical).toContain('\nhost:Example.com\n');
    expect(canonical).toContain('\nx-amz-date:20260101T000000Z\n');
  });

  it('sha256Hex matches known empty-string digest', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('deriveSigningKey', () => {
  it('produces 32-byte HMAC chain', () => {
    const key = deriveSigningKey('secret', '20260101', 'us-east-2', 's3');
    expect(key).toHaveLength(32);
  });

  it('differs for different secrets / dates / regions', () => {
    const a = deriveSigningKey('sa', '20260101', 'us-east-2', 's3');
    const b = deriveSigningKey('sb', '20260101', 'us-east-2', 's3');
    const c = deriveSigningKey('sa', '20260102', 'us-east-2', 's3');
    const d = deriveSigningKey('sa', '20260101', 'us-west-1', 's3');
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(d)).toBe(false);
  });
});

describe('buildStringToSign', () => {
  it('concatenates per AWS SigV4 format', () => {
    const sts = buildStringToSign({
      datetime: '20150830T123600Z',
      scope: '20150830/us-east-1/s3/aws4_request',
      canonicalRequestHash: 'abc123',
    });
    expect(sts).toBe(
      'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/s3/aws4_request\nabc123'
    );
  });
});

describe('verifyHeaderSignature', () => {
  const secret = 's'.repeat(40);
  const datetime = '20260101T000000Z';
  const date = '20260101';
  const region = 'us-east-2';

  function sign(
    method: string,
    path: string,
    query: string,
    headers: Record<string, string>,
    payloadHash: string
  ) {
    const signedHeaders = ['host', 'x-amz-date'];
    const canonical = buildCanonicalRequest({
      method,
      path,
      query,
      headers,
      signedHeaders,
      payloadHash,
    });
    const scope = `${date}/${region}/s3/aws4_request`;
    const sts = buildStringToSign({ datetime, scope, canonicalRequestHash: sha256Hex(canonical) });
    const key = deriveSigningKey(secret, date, region, 's3');
    return crypto.createHmac('sha256', key).update(sts).digest('hex');
  }

  it('accepts a valid signature', () => {
    const headers = { host: 'example.com', 'x-amz-date': datetime };
    const expectedSig = sign('GET', '/my-bucket', '', headers, 'UNSIGNED-PAYLOAD');
    const result = verifyHeaderSignature({
      authorization: `AWS4-HMAC-SHA256 Credential=INSFXXXX/${date}/${region}/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${expectedSig}`,
      secret,
      method: 'GET',
      path: '/my-bucket',
      query: '',
      headers,
      payloadHash: 'UNSIGNED-PAYLOAD',
      expectedRegion: region,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessKeyId).toBe('INSFXXXX');
      expect(result.seedSignature).toBe(expectedSig);
    }
  });

  it('rejects wrong signature', () => {
    const res = verifyHeaderSignature({
      authorization: `AWS4-HMAC-SHA256 Credential=INSFXXXX/${date}/${region}/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${'0'.repeat(64)}`,
      secret,
      method: 'GET',
      path: '/',
      query: '',
      headers: { host: 'h', 'x-amz-date': datetime },
      payloadHash: 'UNSIGNED-PAYLOAD',
      expectedRegion: region,
    });
    expect(res.ok).toBe(false);
  });

  it('rejects wrong region in credential scope', () => {
    const res = verifyHeaderSignature({
      authorization: `AWS4-HMAC-SHA256 Credential=INSFXXXX/${date}/us-west-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${'0'.repeat(64)}`,
      secret,
      method: 'GET',
      path: '/',
      query: '',
      headers: { host: 'h', 'x-amz-date': datetime },
      payloadHash: 'UNSIGNED-PAYLOAD',
      expectedRegion: region,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('AuthorizationHeaderMalformed');
      expect(res.reason).toMatch(/region/i);
    }
  });

  it('rejects malformed Authorization header', () => {
    const res = verifyHeaderSignature({
      authorization: 'Bearer abc',
      secret,
      method: 'GET',
      path: '/',
      query: '',
      headers: { host: 'h', 'x-amz-date': datetime },
      payloadHash: 'UNSIGNED-PAYLOAD',
      expectedRegion: region,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('AuthorizationHeaderMalformed');
  });
});
