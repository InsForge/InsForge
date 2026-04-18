import crypto from 'crypto';
import logger from '@/utils/logger.js';

/**
 * EncryptionManager - Handles encryption/decryption operations
 * Infrastructure layer for secrets encryption
 *
 * Versioned format:  v<version>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Legacy format:     <iv_hex>:<authTag_hex>:<ciphertext_hex>   (treated as v1)
 *
 * Key rotation:
 *   Configure multiple key versions via env vars:
 *     ENCRYPTION_KEY_V1=<32+ char secret>
 *     ENCRYPTION_KEY_V2=<32+ char secret>
 *     ENCRYPTION_KEY_CURRENT_VERSION=2   # which version is used for new encryptions
 *
 *   Backward-compat: a bare `ENCRYPTION_KEY` (or `JWT_SECRET` fallback) is loaded as v1.
 *   If no `ENCRYPTION_KEY_CURRENT_VERSION` is set, the highest configured version is used.
 *
 *   To rotate: add a new ENCRYPTION_KEY_V<N+1>, set CURRENT_VERSION to N+1, then run
 *   the re-encrypt-column endpoint to migrate ciphertexts to the new key. Old keys must
 *   remain in the env until all data is re-encrypted, otherwise old ciphertexts cannot
 *   be decrypted.
 */
export class EncryptionManager {
  private static keyMap: Map<number, Buffer> | null = null;
  private static currentKeyVersion: number | null = null;

  /** Build the key map from env vars (lazy). */
  private static loadKeys(): { keys: Map<number, Buffer>; current: number } {
    if (this.keyMap && this.currentKeyVersion !== null) {
      return { keys: this.keyMap, current: this.currentKeyVersion };
    }

    const keys = new Map<number, Buffer>();

    // Load any ENCRYPTION_KEY_V<N> entries
    for (const [envName, envValue] of Object.entries(process.env)) {
      const match = envName.match(/^ENCRYPTION_KEY_V(\d+)$/);
      if (match && envValue) {
        const version = parseInt(match[1], 10);
        keys.set(version, crypto.createHash('sha256').update(envValue).digest());
      }
    }

    // Backward-compat: bare ENCRYPTION_KEY (or JWT_SECRET fallback) registers as v1
    const legacyKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
    if (legacyKey && !keys.has(1)) {
      keys.set(1, crypto.createHash('sha256').update(legacyKey).digest());
      if (!process.env.ENCRYPTION_KEY) {
        logger.warn(
          'ENCRYPTION_KEY is not set — falling back to JWT_SECRET for secrets encryption. ' +
            'WARNING: rotating JWT_SECRET without setting a dedicated ENCRYPTION_KEY will corrupt all stored secrets. ' +
            'Set ENCRYPTION_KEY (or ENCRYPTION_KEY_V1) to a separate 32+ character secret in your environment.'
        );
      }
    }

    if (keys.size === 0) {
      throw new Error(
        'No encryption keys configured. Set ENCRYPTION_KEY, ENCRYPTION_KEY_V1, or JWT_SECRET.'
      );
    }

    // Determine current version: explicit env, or highest configured
    let current: number;
    const explicitCurrent = process.env.ENCRYPTION_KEY_CURRENT_VERSION;
    if (explicitCurrent) {
      current = parseInt(explicitCurrent, 10);
      if (isNaN(current) || !keys.has(current)) {
        throw new Error(
          `ENCRYPTION_KEY_CURRENT_VERSION=${explicitCurrent} but no matching ENCRYPTION_KEY_V${explicitCurrent} is configured`
        );
      }
    } else {
      current = Math.max(...keys.keys());
    }

    this.keyMap = keys;
    this.currentKeyVersion = current;
    return { keys, current };
  }

  private static getKeyForVersion(version: number): Buffer {
    const { keys } = this.loadKeys();
    const key = keys.get(version);
    if (!key) {
      throw new Error(
        `No encryption key configured for version ${version}. ` +
          `Set ENCRYPTION_KEY_V${version} to decrypt ciphertexts written with this key version.`
      );
    }
    return key;
  }

  /**
   * Encrypt a value using AES-256-GCM (legacy unversioned format for backward compat).
   * Always uses the current key version.
   */
  static encrypt(value: string): string {
    const { current } = this.loadKeys();
    const encryptionKey = this.getKeyForVersion(current);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value using AES-256-GCM. Parses the version prefix and looks up
   * the matching key. Legacy unversioned ciphertexts are decrypted with the v1 key.
   */
  static decrypt(ciphertext: string): string {
    // Parse version prefix; default to 1 for legacy
    let version = 1;
    let payload = ciphertext;
    const versionMatch = ciphertext.match(/^v(\d+):/);
    if (versionMatch) {
      version = parseInt(versionMatch[1], 10);
      payload = ciphertext.substring(ciphertext.indexOf(':') + 1);
    }

    const encryptionKey = this.getKeyForVersion(version);

    const parts = payload.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    // Ensure the authentication tag is exactly 16 bytes for GCM mode
    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt a value with version prefix for column-level encryption.
   * Format: v<version>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
   */
  static encryptVersioned(value: string): string {
    const { current } = this.loadKeys();
    return `v${current}:${this.encrypt(value)}`;
  }

  /**
   * Extract the key version from a versioned ciphertext.
   * Returns 1 for legacy (unversioned) ciphertexts.
   */
  static getKeyVersion(ciphertext: string): number {
    const match = ciphertext.match(/^v(\d+):/);
    return match ? parseInt(match[1], 10) : 1;
  }

  /** Returns the current key version used for new encryptions */
  static getCurrentKeyVersion(): number {
    const { current } = this.loadKeys();
    return current;
  }

  /**
   * Check whether at least one encryption key is configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.ENCRYPTION_KEY ||
      process.env.JWT_SECRET ||
      Object.keys(process.env).some((k) => /^ENCRYPTION_KEY_V\d+$/.test(k))
    );
  }

  /**
   * Reset cached keys. Test-only — not used in production code paths.
   */
  static resetForTesting(): void {
    this.keyMap = null;
    this.currentKeyVersion = null;
  }
}
