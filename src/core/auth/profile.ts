import { DatabaseManager, Profile } from '@/core/database/database.js';
import { UpdateProfileRequest } from '@/types/profile.js';

export class ProfileService {
  private getDb() {
    const dbManager = DatabaseManager.getInstance();
    return dbManager.getDb();
  }

  async getProfileByAuthId(authId: string): Promise<Profile | null> {
    const db = this.getDb();
    const profile = (await db
      .prepare(
        `
      SELECT * FROM _profiles WHERE auth_id = ?
    `
      )
      .get(authId)) as Profile | null;

    return profile;
  }

  async getProfileById(profileId: string): Promise<Profile | null> {
    const db = this.getDb();
    const profile = (await db
      .prepare(
        `
      SELECT * FROM _profiles WHERE id = ?
    `
      )
      .get(profileId)) as Profile | null;

    return profile;
  }

  async updateProfile(authId: string, updates: UpdateProfileRequest): Promise<Profile | null> {
    const db = this.getDb();

    // Build dynamic update query
    const updateFields: string[] = [];
    const values: (string | undefined)[] = [];

    if (updates.name !== undefined) {
      updateFields.push('name = ?');
      values.push(updates.name);
    }

    if (updates.avatar_url !== undefined) {
      updateFields.push('avatar_url = ?');
      values.push(updates.avatar_url);
    }

    if (updates.bio !== undefined) {
      updateFields.push('bio = ?');
      values.push(updates.bio);
    }

    if (updates.metadata !== undefined) {
      updateFields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (updateFields.length === 0) {
      // No updates provided, return current profile
      return this.getProfileByAuthId(authId);
    }

    // Add auth_id to values for WHERE clause
    values.push(authId);

    await db
      .prepare(
        `
      UPDATE _profiles 
      SET ${updateFields.join(', ')}
      WHERE auth_id = ?
    `
      )
      .run(...values);

    return this.getProfileByAuthId(authId);
  }

  async getProfilesByMetadata(key: string, value: string | number | boolean): Promise<Profile[]> {
    const db = this.getDb();

    // PostgreSQL JSONB query
    const profiles = (await db
      .prepare(
        `
      SELECT * FROM _profiles 
      WHERE metadata @> ?
      ORDER BY created_at DESC
    `
      )
      .all(JSON.stringify({ [key]: value }))) as Profile[];

    return profiles;
  }

  async searchProfiles(searchTerm: string): Promise<Profile[]> {
    const db = this.getDb();

    // Search in name and bio
    const profiles = (await db
      .prepare(
        `
      SELECT * FROM _profiles 
      WHERE 
        name ILIKE ? OR 
        bio ILIKE ?
      ORDER BY created_at DESC
      LIMIT 50
    `
      )
      .all(`%${searchTerm}%`, `%${searchTerm}%`)) as Profile[];

    return profiles;
  }
}
