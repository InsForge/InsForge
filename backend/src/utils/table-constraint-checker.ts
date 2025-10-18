import { ColumnSchema } from '@insforge/shared-schemas';
import { AxiosInstance } from 'axios';
import logger from '@/utils/logger.js';

const BATCH_CHUNK_SIZE = 100;
const BATCH_DELAY_MS = 50;

interface ConstraintCheckCallbacks {
  checkUnique: (tableName: string, columnName: string, value: unknown) => boolean;
  checkForeignKey: (refTable: string, refColumn: string, value: unknown) => boolean;
}

/**
 * Fetch existing values from database using batch queries
 * Chunks requests to avoid URL length limits
 */
async function fetchExistingValuesFromDB(
  postgrestAxios: AxiosInstance,
  postgrestUrl: string,
  adminToken: string,
  targetTable: string,
  targetColumn: string,
  values: string[]
): Promise<Set<string>> {
  if (values.length === 0) {
    return new Set<string>();
  }

  const existingValues = new Set<string>();

  try {
    for (let i = 0; i < values.length; i += BATCH_CHUNK_SIZE) {
      const chunk = values.slice(i, i + BATCH_CHUNK_SIZE);
      const escapedValues = chunk.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',');

      const params = {
        select: targetColumn,
        [targetColumn]: `in.(${escapedValues})`,
      };

      logger.debug('Batch querying DB for existing values', {
        targetTable,
        targetColumn,
        valueCount: chunk.length,
        chunkIndex: Math.floor(i / BATCH_CHUNK_SIZE) + 1,
        totalChunks: Math.ceil(values.length / BATCH_CHUNK_SIZE),
      });

      const response = await postgrestAxios.get(`${postgrestUrl}/${targetTable}`, {
        params,
        headers: {
          authorization: `Bearer ${adminToken}`,
          Accept: 'application/json',
        },
      });

      if (Array.isArray(response.data)) {
        for (const row of response.data) {
          const val = row[targetColumn];
          if (val !== undefined && val !== null) {
            existingValues.add(String(val));
          }
        }
      }

      // Small delay between chunks to avoid overwhelming database
      if (i + BATCH_CHUNK_SIZE < values.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    logger.info('Batch query completed', {
      targetTable,
      targetColumn,
      inputValueCount: values.length,
      foundValueCount: existingValues.size,
    });

    return existingValues;
  } catch (error) {
    logger.error('Failed to fetch existing values from database', {
      targetTable,
      targetColumn,
      valueCount: values.length,
      error: error instanceof Error ? error.message : String(error),
    });

    return new Set<string>();
  }
}

/**
 * Build constraint checker callbacks using pre-fetched database values
 */
function buildConstraintCheckers(
  existingDbValues: Record<string, Set<string>>
): ConstraintCheckCallbacks {
  return {
    checkUnique: (_tableName: string, columnName: string, value: unknown): boolean => {
      const set = existingDbValues[columnName];
      return set ? set.has(String(value)) : false;
    },

    checkForeignKey: (refTable: string, refColumn: string, value: unknown): boolean => {
      const key = `${refTable}.${refColumn}`;
      const set = existingDbValues[key];
      return set ? set.has(String(value)) : false;
    },
  };
}

/**
 * Fetch all constraint values from database for CSV validation
 * Pre-fetches UNIQUE and FOREIGN KEY values in batch queries
 */
async function fetchConstraintValuesFromDB(
  postgrestAxios: AxiosInstance,
  postgrestUrl: string,
  adminToken: string,
  tableName: string,
  tableColumns: ColumnSchema[],
  candidateValues: Record<string, Set<string>>
): Promise<Record<string, Set<string>>> {
  const existingDbValues: Record<string, Set<string>> = {};

  // Identify columns with constraints
  const uniqueColumns = tableColumns.filter((c) => c.isUnique).map((c) => c.columnName);

  const fkColumns = tableColumns
    .filter((c) => c.foreignKey)
    .map((c) => ({
      column: c.columnName,
      refTable: c.foreignKey?.referenceTable || '',
      refColumn: c.foreignKey?.referenceColumn || 'id',
    }));

  logger.info('Constraint columns identified', {
    tableName,
    uniqueColumnCount: uniqueColumns.length,
    fkColumnCount: fkColumns.length,
  });

  try {
    // Query unique columns
    for (const col of uniqueColumns) {
      const candidateVals = Array.from(candidateValues[col] || []);
      if (candidateVals.length > 0) {
        logger.debug(`Querying existing values for unique column: ${col}`, {
          candidateCount: candidateVals.length,
        });

        existingDbValues[col] = await fetchExistingValuesFromDB(
          postgrestAxios,
          postgrestUrl,
          adminToken,
          tableName,
          col,
          candidateVals
        );
      }
    }

    // Query foreign key references
    for (const fk of fkColumns) {
      const key = `${fk.column}|FK`;
      const candidateVals = Array.from(candidateValues[key] || []);

      if (candidateVals.length > 0) {
        if (!fk.refTable) {
          logger.warn(`Skipping FK query: missing reference table for column ${fk.column}`, {
            tableName,
            column: fk.column,
          });
          continue;
        }

        logger.debug(
          `Querying existing values for FK column: ${fk.column} -> ${fk.refTable}.${fk.refColumn}`,
          {
            candidateCount: candidateVals.length,
          }
        );

        const dbKey = `${fk.refTable}.${fk.refColumn}`;
        existingDbValues[dbKey] = await fetchExistingValuesFromDB(
          postgrestAxios,
          postgrestUrl,
          adminToken,
          fk.refTable,
          fk.refColumn,
          candidateVals
        );
      }
    }

    logger.info('Database batch queries completed', {
      tableName,
      queriesPerformed: Object.keys(existingDbValues).length,
    });

    return existingDbValues;
  } catch (error) {
    logger.error('Database batch query failed', { error });
    throw error;
  }
}

export { ConstraintCheckCallbacks, buildConstraintCheckers, fetchConstraintValuesFromDB };
