import { Transform, type TransformCallback } from 'stream';
import pgFormat from 'pg-format';

/**
 * Transforms database rows into a JSON array stream.
 * Automatically outputs [ at start, comma-separated row objects, and ] at end.
 * If 0 rows are processed, outputs [].
 */
export class JsonExportTransform extends Transform {
  private isFirst = true;

  constructor() {
    super({ writableObjectMode: true, readableObjectMode: false });
  }

  override _transform(
    row: Record<string, unknown>,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      if (this.isFirst) {
        this.push('[' + JSON.stringify(row));
        this.isFirst = false;
      } else {
        this.push(',' + JSON.stringify(row));
      }
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _flush(callback: TransformCallback): void {
    if (this.isFirst) {
      // Stream received 0 rows
      this.push('[]');
    } else {
      this.push(']');
    }
    callback();
  }
}

/**
 * Escapes a CSV field according to RFC 4180 rules.
 */
function escapeCsvValue(val: unknown): string {
  if (val === null || val === undefined) {
    return '';
  }
  let strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
  if (/^\s*[=+\-@\t\r]/.test(strVal)) {
    strVal = "'" + strVal;
  }
  if (
    strVal.includes(',') ||
    strVal.includes('"') ||
    strVal.includes('\n') ||
    strVal.includes('\r')
  ) {
    return `"${strVal.replace(/"/g, '""')}"`;
  }
  return strVal;
}

/**
 * Transforms database rows into a CSV stream.
 * Extracts headers from the keys of the first row chunk automatically.
 */
export class CsvExportTransform extends Transform {
  private isFirst = true;
  private headers: string[] = [];

  constructor() {
    super({ writableObjectMode: true, readableObjectMode: false });
  }

  override _transform(
    row: Record<string, unknown>,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      if (this.isFirst) {
        this.headers = Object.keys(row);
        const headerLine = this.headers.map(escapeCsvValue).join(',') + '\n';
        this.push(headerLine);
        this.isFirst = false;
      }
      const dataLine = this.headers.map((h) => escapeCsvValue(row[h])).join(',') + '\n';
      this.push(dataLine);
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _flush(callback: TransformCallback): void {
    callback();
  }
}

/**
 * Transforms database rows into an SQL INSERT statement stream.
 * Generates INSERT INTO table_name (...) VALUES (...); per row.
 */
export class SqlExportTransform extends Transform {
  constructor(
    private table: string,
    private schemaName?: string
  ) {
    super({ writableObjectMode: true, readableObjectMode: false });
  }

  private formatSqlValue(val: unknown): string {
    if (Buffer.isBuffer(val)) {
      return `E'\\\\x${val.toString('hex')}'`;
    }
    if (val === null || val === undefined) {
      return 'NULL';
    } else if (typeof val === 'string') {
      return `'${val.replace(/'/g, "''")}'`;
    } else if (val instanceof Date) {
      return `'${val.toISOString()}'`;
    } else if (typeof val === 'object') {
      return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    } else if (typeof val === 'boolean') {
      return val ? 'true' : 'false';
    } else {
      return String(val);
    }
  }

  override _transform(
    row: Record<string, unknown>,
    encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    try {
      const columns = Object.keys(row);
      const values = Object.values(row).map((v) => this.formatSqlValue(v));
      const targetTable = this.schemaName
        ? pgFormat('%I.%I', this.schemaName, this.table)
        : pgFormat('%I', this.table);
      const statement = `INSERT INTO ${targetTable} (${columns.map((c) => pgFormat('%I', c)).join(', ')}) VALUES (${values.join(', ')});\n`;
      this.push(statement);
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  override _flush(callback: TransformCallback): void {
    callback();
  }
}
