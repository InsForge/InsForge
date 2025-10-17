import { Readable } from 'stream';
import { parse } from 'fast-csv';
import { ColumnSchema } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

interface PreScanResult {
  headers: string[];
  uniqueColumns: Array<{ column: string }>;
  fkColumns: Array<{ column: string; refTable: string; refColumn: string }>;
  candidateValues: Record<string, Set<string>>;
}

/**
 * Pre-scan CSV file to collect candidate values for constraint checking
 * Returns headers, column metadata, and distinct values found in the file
 */
async function preScanCSVForCandidates(
  fileBuffer: Buffer,
  tableColumns: ColumnSchema[]
): Promise<PreScanResult> {
  let headers: string[] = [];
  const uniqueColumns = tableColumns
    .filter((c) => c.isUnique)
    .map((c) => ({ column: c.columnName }));
  const fkColumns = tableColumns
    .filter((c) => c.foreignKey)
    .map((c) => ({
      column: c.columnName,
      refTable: c.foreignKey?.referenceTable || '',
      refColumn: c.foreignKey?.referenceColumn || 'id',
    }));

  const candidateValues: Record<string, Set<string>> = {};

  // Initialize sets for each constraint column
  uniqueColumns.forEach((col) => {
    candidateValues[col.column] = new Set<string>();
  });

  fkColumns.forEach((fk) => {
    const key = `${fk.column}|FK`;
    candidateValues[key] = new Set<string>();
  });

  // Stream parse CSV and collect distinct values
  await new Promise<void>((resolve, reject) => {
    const stream = Readable.from([fileBuffer]);

    stream
      .pipe(
        parse({
          headers: true,
          trim: true,
        })
      )
      .on('headers', (parsedHeaders: string[]) => {
        headers = parsedHeaders.map((h) => String(h).trim());
      })
      .on('data', (row: Record<string, string>) => {
        // Collect unique column candidates
        for (const col of uniqueColumns) {
          const raw = row[col.column];
          if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            candidateValues[col.column].add(String(raw).trim());
          }
        }

        // Collect foreign key candidates
        for (const fk of fkColumns) {
          const raw = row[fk.column];
          if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
            const key = `${fk.column}|FK`;
            candidateValues[key].add(String(raw).trim());
          }
        }
      })
      .on('error', (err: Error) => {
        reject(new Error(`CSV pre-scan failed: ${err.message}`));
      })
      .on('end', () => resolve());
  });

  return {
    headers,
    uniqueColumns,
    fkColumns,
    candidateValues,
  };
}

/**
 * Log pre-scan results for debugging
 */
function logPreScanResults(tableName: string, preScanResult: PreScanResult): void {
  logger.info('CSV pre-scan completed', {
    tableName,
    headerCount: preScanResult.headers.length,
    uniqueColumnsCandidates: Object.fromEntries(
      preScanResult.uniqueColumns.map((col) => [
        col.column,
        preScanResult.candidateValues[col.column]?.size ?? 0,
      ])
    ),
    fkColumnsCandidates: Object.fromEntries(
      preScanResult.fkColumns.map((fk) => [
        `${fk.column}(${fk.refTable}.${fk.refColumn})`,
        preScanResult.candidateValues[`${fk.column}|FK`]?.size ?? 0,
      ])
    ),
  });
}

export { PreScanResult, preScanCSVForCandidates, logPreScanResults };
