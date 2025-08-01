import { DatabaseManager } from './database.js';
import crypto from 'crypto';

export class VaultService {
  private db: DatabaseManager;
  private encryptionKey: string;

  constructor(db: DatabaseManager) {
    this.db = db;
    // Use environment variable or generate a default key
    this.encryptionKey = process.env.VAULT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
  }

  // Encryption helper
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  // Decryption helper
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey, 'hex'), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Get all secrets (returns names only, not values)
  async getAllSecrets(userId: string): Promise<any[]> {
    const stmt = this.db.prepare(
      `SELECT id, name, description, created_at, updated_at 
       FROM _vault 
       WHERE created_by = ? 
       ORDER BY name`
    );
    return await stmt.all(userId);
  }

  // Get all secrets for admin (returns names only, not values)
  async getAllSecretsAdmin(): Promise<any[]> {
    const stmt = this.db.prepare(
      `SELECT v.id, v.name, v.description, v.created_at, v.updated_at,
              COALESCE(u.email, su.email) as created_by_email
       FROM _vault v
       LEFT JOIN _auth u ON v.created_by = u.id
       LEFT JOIN _superuser_auth su ON v.created_by = su.id
       ORDER BY v.name`
    );
    return await stmt.all();
  }

  // Get a specific secret by name for admin
  async getSecretAdmin(name: string): Promise<any | null> {
    const stmt = this.db.prepare(
      `SELECT id, name, value, description, created_at, updated_at 
       FROM _vault 
       WHERE name = ?`
    );
    
    const secret = await stmt.get(name);
    
    if (!secret) {
      return null;
    }

    // Decrypt the value before returning
    secret.value = this.decrypt(secret.value);
    return secret;
  }

  // Get a specific secret by name
  async getSecret(name: string, userId: string): Promise<any | null> {
    const stmt = this.db.prepare(
      `SELECT id, name, value, description, created_at, updated_at 
       FROM _vault 
       WHERE name = ? AND created_by = ?`
    );
    
    const secret = await stmt.get(name, userId);
    
    if (!secret) {
      return null;
    }

    // Decrypt the value before returning
    secret.value = this.decrypt(secret.value);
    return secret;
  }

  // Create or update a secret
  async upsertSecret(name: string, value: string, description: string | null, userId: string): Promise<any> {
    const encryptedValue = this.encrypt(value);
    
    const stmt = this.db.prepare(
      `INSERT INTO _vault (name, value, description, created_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (name) 
       DO UPDATE SET 
         value = EXCLUDED.value,
         description = EXCLUDED.description,
         updated_at = NOW()
       RETURNING id, name, description, created_at, updated_at`
    );
    
    const result = await stmt.get(name, encryptedValue, description, userId);
    return result;
  }

  // Create or update a secret (admin version - no user tracking)
  async upsertSecretAdmin(name: string, value: string, description: string | null): Promise<any> {
    const encryptedValue = this.encrypt(value);
    
    // First check if secret exists
    const existing = await this.db.prepare('SELECT created_by FROM _vault WHERE name = ?').get(name);
    
    if (existing) {
      // Update existing secret, keeping original created_by
      const stmt = this.db.prepare(
        `UPDATE _vault SET 
         value = ?,
         description = ?,
         updated_at = NOW()
         WHERE name = ?
         RETURNING id, name, description, created_at, updated_at`
      );
      return await stmt.get(encryptedValue, description, name);
    } else {
      // For new secrets via admin/API, use the superuser auth ID
      const adminUser = await this.db.prepare('SELECT id FROM _superuser_auth LIMIT 1').get();
      if (!adminUser) {
        throw new Error('No admin user found to create secret');
      }
      
      const stmt = this.db.prepare(
        `INSERT INTO _vault (name, value, description, created_by)
         VALUES (?, ?, ?, ?)
         RETURNING id, name, description, created_at, updated_at`
      );
      return await stmt.get(name, encryptedValue, description, adminUser.id);
    }
  }

  // Delete a secret (admin)
  async deleteSecretAdmin(name: string): Promise<boolean> {
    const stmt = this.db.prepare(
      `DELETE FROM _vault 
       WHERE name = ?
       RETURNING id`
    );
    
    const result = await stmt.run(name);
    return result.changes > 0;
  }

  // Delete a secret
  async deleteSecret(name: string, userId: string): Promise<boolean> {
    const stmt = this.db.prepare(
      `DELETE FROM _vault 
       WHERE name = ? AND created_by = ?
       RETURNING id`
    );
    
    const result = await stmt.run(name, userId);
    return result.changes > 0;
  }

  // Get functions using a specific secret (admin)
  async getSecretFunctionsAdmin(name: string): Promise<any[]> {
    const stmt = this.db.prepare(
      `SELECT ef.id, ef.slug, ef.name, ef.description, ef.status
       FROM _edge_functions ef
       JOIN _function_secrets fs ON ef.id = fs.function_id
       JOIN _vault v ON fs.vault_id = v.id
       WHERE v.name = ?
       ORDER BY ef.name`
    );
    
    return await stmt.all(name);
  }

  // Get functions using a specific secret
  async getSecretFunctions(name: string, userId: string): Promise<any[]> {
    const stmt = this.db.prepare(
      `SELECT ef.id, ef.slug, ef.name, ef.description, ef.status
       FROM _edge_functions ef
       JOIN _function_secrets fs ON ef.id = fs.function_id
       JOIN _vault v ON fs.vault_id = v.id
       WHERE v.name = ? AND v.created_by = ?
       ORDER BY ef.name`
    );
    
    return await stmt.all(name, userId);
  }

  // Associate a secret with a function
  async linkSecretToFunction(secretName: string, functionId: string, userId: string): Promise<void> {
    // First, get the vault ID - allow any secret for now (remove user check)
    const vaultStmt = this.db.prepare(
      `SELECT id FROM _vault WHERE name = ?`
    );
    const vault = await vaultStmt.get(secretName);
    
    if (!vault) {
      throw new Error('Secret not found');
    }
    
    // Insert the association
    const linkStmt = this.db.prepare(
      `INSERT INTO _function_secrets (function_id, vault_id)
       VALUES (?, ?)
       ON CONFLICT DO NOTHING`
    );
    await linkStmt.run(functionId, vault.id);
  }

  // Remove secret association from a function
  async unlinkSecretFromFunction(secretName: string, functionId: string, userId: string): Promise<void> {
    const stmt = this.db.prepare(
      `DELETE FROM _function_secrets
       WHERE function_id = ? 
       AND vault_id = (SELECT id FROM _vault WHERE name = ? AND created_by = ?)`
    );
    await stmt.run(functionId, secretName, userId);
  }
}