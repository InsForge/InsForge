import crypto from 'crypto';
import logger from '@/utils/logger.js';

/** Current key version used for new encryptions */
const CURRENT_KEY_VERSION = 1;

/**
 * EncryptionManager - Handles encryption/decryption operations
 * Infrastructure layer for secrets encryption
 *
 * Versioned format:  v<version>:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Legacy format:     <iv_hex>:<authTag_hex>:<ciphertext_hex>   (treated as v1)
 */
export class EncryptionManager {
  private static encryptionKey: Buffer | null = null;

  private static getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!key) {
        throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set for secrets encryption');
      }
      if (!process.env.ENCRYPTION_KEY) {
        logger.warn(
          'ENCRYPTION_KEY is not set — falling back to JWT_SECRET for secrets encryption. ' +
            'WARNING: rotating JWT_SECRET without setting a dedicated ENCRYPTION_KEY will corrupt all stored secrets. ' +
            'Set ENCRYPTION_KEY to a separate 32+ character secret in your environment.'
        );
      }
      this.encryptionKey = crypto.createHash('sha256').update(key).digest();
    }
    return this.encryptionKey;
  }

  /**
   * Encrypt a value using AES-256-GCM (legacy unversioned format for backward compat)
   */
  static encrypt(value: string): string {
    const encryptionKey = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value using AES-256-GCM (handles both versioned and legacy formats)
   */
  static decrypt(ciphertext: string): string {
    const encryptionKey = this.getEncryptionKey();

    // Strip version prefix if present (e.g., "v1:iv:tag:data" → "iv:tag:data")
    let payload = ciphertext;
    if (/^v\d+:/.test(ciphertext)) {
      payload = ciphertext.substring(ciphertext.indexOf(':') + 1);
    }

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
    return `v${CURRENT_KEY_VERSION}:${this.encrypt(value)}`;
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
    return CURRENT_KEY_VERSION;
  }

  /**
   * Check whether ENCRYPTION_KEY (or JWT_SECRET fallback) is configured
   */
  static isConfigured(): boolean {
    return !!(process.env.ENCRYPTION_KEY || process.env.JWT_SECRET);
  }
}
