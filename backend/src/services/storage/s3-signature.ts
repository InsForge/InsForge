import crypto from 'crypto';

export interface CanonicalRequestInput {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  signedHeaders: string[];
  payloadHash: string;
}

/**
 * Encode per AWS SigV4 rules:
 *   - Unreserved: A-Z a-z 0-9 - _ . ~
 *   - Space → %20 (not +)
 *   - '/' in path segments is NOT encoded when encodeSlash=false
 */
function uriEncode(str: string, encodeSlash: boolean): string {
  let out = '';
  for (const ch of str) {
    if (/[A-Za-z0-9\-_.~]/.test(ch)) {
      out += ch;
    } else if (ch === '/' && !encodeSlash) {
      out += '/';
    } else {
      const bytes = Buffer.from(ch, 'utf8');
      for (const b of bytes) {
        out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      }
    }
  }
  return out;
}

function canonicalizePath(p: string): string {
  return uriEncode(p, false);
}

function canonicalizeQuery(q: string): string {
  if (!q) return '';
  const pairs = q.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    const v = eq >= 0 ? pair.slice(eq + 1) : '';
    const dk = safeDecode(k);
    const dv = safeDecode(v);
    return [uriEncode(dk, true), uriEncode(dv, true)] as [string, string];
  });
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function buildCanonicalRequest(input: CanonicalRequestInput): string {
  const canonicalHeaders = input.signedHeaders
    .map((h) => {
      const rawEntry =
        input.headers[h] ??
        input.headers[h.toLowerCase()] ??
        Object.entries(input.headers).find(([k]) => k.toLowerCase() === h)?.[1];
      const raw = rawEntry ?? '';
      const val = String(raw).replace(/\s+/g, ' ').trim();
      return `${h}:${val}`;
    })
    .join('\n');

  return [
    input.method.toUpperCase(),
    canonicalizePath(input.path),
    canonicalizeQuery(input.query),
    canonicalHeaders,
    '',
    input.signedHeaders.join(';'),
    input.payloadHash,
  ].join('\n');
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
