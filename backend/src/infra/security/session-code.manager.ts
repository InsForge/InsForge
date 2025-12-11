/**
 * Session Code Manager for PKCE Exchange
 * 
 * Manages temporary session codes used in the OAuth PKCE flow.
 * Session codes are one-time use and expire after a short period.
 */

interface SessionCodeData {
  accessToken: string;
  user: any;
  codeChallenge?: string;
  expiresAt: number;
}

// In-memory store for session codes
// Consider using Redis for production clustering
const sessionCodeStore = new Map<string, SessionCodeData>();

// Clean up expired session codes periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of sessionCodeStore.entries()) {
    if (now > data.expiresAt) {
      sessionCodeStore.delete(code);
    }
  }
}, 60000); // Every minute

/**
 * Generate a cryptographically secure session code
 */
function generateSessionCode(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store session data with a session code
 * @param data - Session data to store
 * @param ttlMs - Time to live in milliseconds (default 5 minutes)
 * @returns Session code
 */
export function storeSessionCode(
  data: Omit<SessionCodeData, 'expiresAt'>,
  ttlMs = 5 * 60 * 1000
): string {
  const code = generateSessionCode();
  sessionCodeStore.set(code, {
    ...data,
    expiresAt: Date.now() + ttlMs,
  });
  return code;
}

/**
 * Retrieve and delete session data by session code (one-time use)
 * @param code - Session code to consume
 * @returns Session data or null if not found/expired
 */
export function consumeSessionCode(code: string): SessionCodeData | null {
  const data = sessionCodeStore.get(code);
  if (!data) return null;

  // Delete immediately (one-time use)
  sessionCodeStore.delete(code);

  // Check expiration
  if (Date.now() > data.expiresAt) {
    return null;
  }

  return data;
}

/**
 * Verify PKCE code_verifier against stored code_challenge
 * @param codeVerifier - The code verifier from client
 * @param codeChallenge - The stored code challenge
 * @returns True if verification passes
 */
export async function verifyPkce(
  codeVerifier: string,
  codeChallenge: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const actualChallenge = btoa(String.fromCharCode(...hashArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return actualChallenge === codeChallenge;
}
