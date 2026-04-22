import { describe, it, expect } from 'vitest';
import { buildCanonicalRequest, sha256Hex } from '@/services/storage/s3-signature.js';

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
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});
