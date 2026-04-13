import { describe, test, expect, vi, beforeEach } from 'vitest';
import { DatabaseTableService } from '../../src/services/database/database-table.service';

// Create a single mock query function to track all database calls
const sharedMockQuery = vi.fn();

// Mock DatabaseManager
vi.mock('../../src/infra/database/database.manager', () => {
  return {
    DatabaseManager: {
      getInstance: vi.fn(() => ({
        getPool: vi.fn(() => ({
          connect: vi.fn().mockResolvedValue({
            query: sharedMockQuery,
            release: vi.fn(),
          }),
          query: sharedMockQuery,
        })),
      })),
    },
  };
});

describe('DatabaseTableService - SQL Injection Verification (Fixed)', () => {
  let service: DatabaseTableService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = DatabaseTableService.getInstance();

    // Setup sequential responses to satisfy code path logic
    sharedMockQuery
      .mockResolvedValueOnce({
        rows: [{ column_name: 'id', data_type: 'uuid', udt_name: 'uuid', is_nullable: 'NO' }],
      }) // 1. Columns schema
      .mockResolvedValueOnce({ rows: [] }) // 2. Fkey constraints (pooled query)
      .mockResolvedValueOnce({ rows: [{ column_name: 'id' }] }) // 3. Primary keys
      .mockResolvedValueOnce({ rows: [] }) // 4. Unique columns
      .mockResolvedValueOnce({ rows: [{ row_count: 0 }] }); // 5. SAFE row count query
  });

  test('getTableSchema correctly escapes table names to prevent SQL injection', async () => {
    // Malicious table name designed to break out of double quotes
    const maliciousTableName = 'users"; DROP TABLE secrets; --';

    try {
      // Execute the method
      await service.getTableSchema(maliciousTableName);
    } catch {
      // Ignore logical errors, we only care about the captured SQL
    }

    // Find the binary query that contains our malicious payload (the COUNT query)
    const injectionQueryCall = sharedMockQuery.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('COUNT(*)')
    );

    expect(injectionQueryCall).toBeDefined();
    const capturedQuery = injectionQueryCall[0];

    console.log('Captured SQL Query:', capturedQuery);

    // Assert that the double-quote WAS escaped, neutralizing the injection
    // PostgreSQL escape for " inside an identifier is ""
    // Correctly escaped should be: "users""; DROP TABLE secrets; --"
    expect(capturedQuery).toContain(`FROM "users""; DROP TABLE secrets; --"`);

    // This proves that the DROP TABLE command is now safely inside the identifier
    // string and will NOT be executed as a separate SQL command.
    expect(capturedQuery).not.toMatch(/FROM "[^"]*"; DROP TABLE/);
  });
});
