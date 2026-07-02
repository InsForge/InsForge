import { describe, expect, it } from 'vitest';
import { detectMimeType, isUnsafeMime, resolveSafeMimeType, UNSAFE_MIME_PREFIXES } from '../../src/utils/mime-guard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A minimal valid 1×1 transparent PNG (67 bytes).
 * Generated via `Buffer.from('<base64>', 'base64')` from a known-good PNG.
 * This is enough for file-type to identify as image/png.
 */
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** A real PDF magic bytes prefix (%%PDF — enough for file-type). */
const PDF_BYTES = Buffer.from('%PDF-1.4 1 0 obj<</Type/Catalog>>endobj', 'utf8');

/** HTML content — no magic bytes, text-based. */
const HTML_BYTES = Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>', 'utf8');

/** SVG content — XML-based, no binary magic bytes. */
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf8');

/** Plain-text CSV — no magic bytes. */
const CSV_BYTES = Buffer.from('id,name,email\n1,Alice,alice@example.com\n', 'utf8');

// ─── detectMimeType ────────────────────────────────────────────────────────────

describe('detectMimeType', () => {
  it('correctly identifies a PNG file from magic bytes', async () => {
    const result = await detectMimeType(PNG_BUFFER);
    expect(result).toBe('image/png');
  });

  it('correctly identifies a PDF file from magic bytes', async () => {
    const result = await detectMimeType(PDF_BYTES);
    expect(result).toBe('application/pdf');
  });

  it('falls back to application/octet-stream for plain-text with no magic bytes', async () => {
    // file-type cannot detect plain text, HTML, SVG — they have no binary signature
    const result = await detectMimeType(HTML_BYTES);
    expect(result).toBe('application/octet-stream');
  });

  it('falls back to application/octet-stream for an empty buffer', async () => {
    const result = await detectMimeType(Buffer.alloc(0));
    expect(result).toBe('application/octet-stream');
  });
});

// ─── isUnsafeMime ─────────────────────────────────────────────────────────────

describe('isUnsafeMime', () => {
  it('returns true for all entries in UNSAFE_MIME_PREFIXES', () => {
    for (const prefix of UNSAFE_MIME_PREFIXES) {
      expect(isUnsafeMime(prefix), `Expected ${prefix} to be unsafe`).toBe(true);
    }
  });

  it('returns true for text/html with charset parameter', () => {
    expect(isUnsafeMime('text/html; charset=utf-8')).toBe(true);
  });

  it('returns true for image/svg+xml', () => {
    expect(isUnsafeMime('image/svg+xml')).toBe(true);
  });

  it('returns true for application/javascript', () => {
    expect(isUnsafeMime('application/javascript')).toBe(true);
  });

  it('returns false for image/jpeg', () => {
    expect(isUnsafeMime('image/jpeg')).toBe(false);
  });

  it('returns false for image/png', () => {
    expect(isUnsafeMime('image/png')).toBe(false);
  });

  it('returns false for application/pdf', () => {
    expect(isUnsafeMime('application/pdf')).toBe(false);
  });

  it('returns false for application/octet-stream', () => {
    expect(isUnsafeMime('application/octet-stream')).toBe(false);
  });

  it('returns false for text/csv', () => {
    expect(isUnsafeMime('text/csv')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isUnsafeMime('TEXT/HTML')).toBe(true);
    expect(isUnsafeMime('Image/SVG+XML')).toBe(true);
  });
});

// ─── resolveSafeMimeType ───────────────────────────────────────────────────────

describe('resolveSafeMimeType', () => {
  it('returns image/png for a real PNG buffer, regardless of client claim', async () => {
    // Client lies and says it is a text/html file
    const result = await resolveSafeMimeType(PNG_BUFFER, 'text/html');
    expect(result).toBe('image/png');
  });

  it('returns application/pdf for a real PDF buffer', async () => {
    const result = await resolveSafeMimeType(PDF_BYTES, 'application/pdf');
    expect(result).toBe('application/pdf');
  });

  it('returns application/octet-stream when magic bytes reveal an unsafe type (text/html detection fallback)', async () => {
    // file-type cannot detect HTML from bytes — detection falls back to octet-stream.
    // But client supplied text/html — isUnsafeMime check catches it.
    const result = await resolveSafeMimeType(HTML_BYTES, 'text/html');
    expect(result).toBe('application/octet-stream');
  });

  it('returns application/octet-stream when client claims image/svg+xml and file is undetectable', async () => {
    const result = await resolveSafeMimeType(SVG_BYTES, 'image/svg+xml');
    expect(result).toBe('application/octet-stream');
  });

  it('returns application/octet-stream when client claims text/javascript', async () => {
    const jsBuf = Buffer.from('console.log("pwned")', 'utf8');
    const result = await resolveSafeMimeType(jsBuf, 'text/javascript');
    expect(result).toBe('application/octet-stream');
  });

  it('honours a safe client-supplied MIME when file-type cannot detect the type (e.g. CSV)', async () => {
    // file-type returns octet-stream for plain CSV; client claim of text/csv is safe
    const result = await resolveSafeMimeType(CSV_BYTES, 'text/csv');
    expect(result).toBe('text/csv');
  });

  it('falls back to application/octet-stream when no client MIME is provided and file is undetectable', async () => {
    const result = await resolveSafeMimeType(CSV_BYTES, undefined);
    expect(result).toBe('application/octet-stream');
  });

  it('a PNG uploaded with a .html extension gets image/png (magic bytes win)', async () => {
    // Attacker renames avatar.png to payload.html hoping to get text/html
    const result = await resolveSafeMimeType(PNG_BUFFER, 'text/html');
    expect(result).toBe('image/png');
  });

  it('an SVG uploaded with a text/plain claim gets caught by content scanner and returns application/octet-stream', async () => {
    // Attacker lies and says SVG is text/plain to bypass mime check
    const result = await resolveSafeMimeType(SVG_BYTES, 'text/plain');
    expect(result).toBe('application/octet-stream');
  });
});
