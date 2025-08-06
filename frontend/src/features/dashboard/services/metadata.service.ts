import { apiClient } from '@/lib/api/client';
import { TableInfo } from '@/features/database/services/database.service';

export interface AppMetadata {
  tables: Record<string, TableInfo>;
  database_size_gb?: number;
  storage_size_gb?: number;
}

export class MetadataService {
  // Get API key (admin only)
  async fetchApiKey() {
    const data = await apiClient.request('/metadata/api-key');
    // data is already unwrapped by request method
    if (data.apiKey) {
      apiClient.setApiKey(data.apiKey);
    }
    return data.apiKey;
  }

  // Get database metadata for dashboard
  getAppMetadata(): Promise<AppMetadata> {
    return apiClient.request('/metadata/database', {
      headers: apiClient.withApiKey(),
    });
  }

  // Get full metadata (new structured format)
  getFullMetadata() {
    return apiClient.request('/metadata', {
      headers: apiClient.withApiKey(),
    });
  }

  // System information
  async getSystemStats() {
    try {
      const metadata = await this.getAppMetadata();
      const tableNames = Object.keys(metadata.tables);
      const totalRecords = Object.values(metadata.tables).reduce(
        (sum, table) => sum + table.recordCount,
        0
      );

      return {
        totalTables: tableNames.length,
        totalRecords,
        tables: metadata.tables,
        databaseSize: '< 1 MB', // SQLite is efficient
      };
    } catch (error) {
      console.error('Error getting system stats:', error);
      return {
        totalTables: 0,
        totalRecords: 0,
        tables: {},
        databaseSize: 'Unknown',
      };
    }
  }
}

export const metadataService = new MetadataService();
