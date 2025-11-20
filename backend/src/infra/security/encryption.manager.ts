import crypto from 'crypto';

/**
 * EncryptionManager - Handles encryption/decryption operations
 * Infrastructure layer for secrets encryption
 */
export class EncryptionManager {
  private static encryptionKey: Buffer | null = null;

  private static getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      const key = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
      if (!key) {
        throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set for secrets encryption');
      }
      this.encryptionKey = crypto.createHash('sha256').update(key).digest();
    }
    return this.encryptionKey;
  }

  /**
   * Encrypt a value using AES-256-GCM
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
   * Decrypt a value using AES-256-GCM
   */
  static decrypt(ciphertext: string): string {
    const encryptionKey = this.getEncryptionKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format');
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
