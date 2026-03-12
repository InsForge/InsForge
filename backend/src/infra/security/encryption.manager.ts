import crypto from 'crypto';

/**
 * EncryptionManager - Handles encryption/decryption operations
 * Infrastructure layer for secrets encryption using AES-256-GCM
 * 
 * @remarks
 * - Uses AES-256-GCM for authenticated encryption
 * - Derives encryption key from ENCRYPTION_KEY or JWT_SECRET environment variable
 * - Stores IV and auth tag with ciphertext for decryption
 * 
 * @example
 * ```typescript
 * const encrypted = EncryptionManager.encrypt('sensitive-data');
 * const decrypted = EncryptionManager.decrypt(encrypted);
 * ```
 */
export class EncryptionManager {
  /** Cached encryption key (derived from environment variable) */
  private static encryptionKey: Buffer | null = null;

  /**
   * Get or derive the encryption key from environment variables
   * @returns 256-bit encryption key as Buffer
   * @throws Error if neither ENCRYPTION_KEY nor JWT_SECRET is set
   */
  private static getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!key) {
        throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set for secrets encryption');
      }
      // Derive a 256-bit key using SHA-256
      this.encryptionKey = crypto.createHash('sha256').update(key).digest();
    }
    return this.encryptionKey;
  }

  /**
   * Encrypt a value using AES-256-GCM
   * 
   * @param value - The plaintext string to encrypt
   * @returns Encrypted ciphertext in format: iv:authTag:encryptedData (hex-encoded)
   * @throws Error if encryption key is not available
   * 
   * @example
   * ```typescript
   * const encrypted = EncryptionManager.encrypt('my-secret');
   * // Returns: "a1b2c3...:d4e5f6...:7g8h9i..."
   * ```
   */
  static encrypt(value: string): string {
    const encryptionKey = this.getEncryptionKey();
    // Generate random 16-byte IV for this encryption
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);

    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get the authentication tag for integrity verification
    const authTag = cipher.getAuthTag();

    // Return IV:authTag:encrypted format
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a value using AES-256-GCM
   * 
   * @param ciphertext - Encrypted data in format: iv:authTag:encryptedData (hex-encoded)
   * @returns Decrypted plaintext string
   * @throws Error if ciphertext format is invalid or decryption fails
   * @throws crypto.webcrypto.SubtleCrypto error if auth tag verification fails
   * 
   * @example
   * ```typescript
   * const decrypted = EncryptionManager.decrypt('a1b2c3...:d4e5f6...:7g8h9i...');
   * // Returns: "my-secret"
   * ```
   */
  static decrypt(ciphertext: string): string {
    const encryptionKey = this.getEncryptionKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format. Expected: iv:authTag:encryptedData');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
