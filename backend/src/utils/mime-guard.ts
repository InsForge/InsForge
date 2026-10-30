import { fileTypeFromBuffer } from 'file-type';

/**
 * MIME types that browsers will execute if served inline from the same origin.
 * Files detected as any of these types must be served with
 * `Content-Disposition: attachment` and stored as `application/octet-stream`
 * to prevent Stored XSS via the storage layer.
 */
export const UNSAFE_MIME_PREFIXES: readonly string[] = [
  'text/html',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/ecmascript',
  'text/ecmascript',
  'application/x-javascript',
  'application/xhtml+xml',
  'application/x-xhtml+xml',
  'text/xml',
  'application/xml',
];

/**
 * Detects the true MIME type of a file buffer using magic-byte inspection.
 * Ignores the client-supplied Content-Type header entirely.
 *
 * Falls back to `'application/octet-stream'` when the type cannot be
 * determined from the first bytes (e.g. plain-text files with no signature).
 */
export async function detectMimeType(buffer: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected?.mime ?? 'application/octet-stream';
}

/**
 * Returns true when the given MIME type is one that browsers will execute
 * as active content (HTML, SVG, JavaScript, XML) if served inline.
 */
export function isUnsafeMime(mime: string): boolean {
  const normalised = mime.split(';')[0].trim().toLowerCase();
  return UNSAFE_MIME_PREFIXES.some((prefix) => normalised === prefix);
}

/**
 * Returns a safe MIME type to store in metadata.
 * If the detected true type is executable, returns `application/octet-stream`
 * so browsers will always download rather than render the file.
 *
 * @param buffer - The full file buffer (already in memory via multer memoryStorage)
 * @param clientMime - The MIME type declared by the uploader (untrusted)
 */
export async function resolveSafeMimeType(buffer: Buffer, clientMime?: string): Promise<string> {
  const detected = await detectMimeType(buffer);

  // If the magic bytes identify an unsafe type, override immediately
  if (isUnsafeMime(detected)) {
    return 'application/octet-stream';
  }

  // If file-type couldn't identify the binary signature (returns octet-stream),
  // it might be a plain-text payload like SVG, HTML, or JS. We scan the first
  // 4KB for obvious active-content tags to catch attackers lying about the MIME type.
  if (detected === 'application/octet-stream') {
    const textChunk = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).toLowerCase();
    if (
      textChunk.includes('<html') ||
      textChunk.includes('<script') ||
      textChunk.includes('<svg') ||
      textChunk.includes('<!doctype html') ||
      textChunk.includes('<body') ||
      textChunk.includes('<iframe') ||
      textChunk.includes('<object') ||
      textChunk.includes('<form')
    ) {
      return 'application/octet-stream';
    }
  }

  // If detection fell back to octet-stream AND the client claimed a safe type,
  // keep the client claim (covers plain-text, CSV, and other type-less files).
  // If the client claimed an unsafe type for a file we could not detect, reject it.
  if (detected === 'application/octet-stream' && clientMime && isUnsafeMime(clientMime)) {
    return 'application/octet-stream';
  }

  // Trust the magic-byte detected type when it is conclusive
  return detected === 'application/octet-stream' && clientMime ? clientMime : detected;
}
