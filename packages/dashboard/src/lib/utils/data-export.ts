/**
 * Export utility for converting data to various formats
 */

interface ExportOptions {
  filename?: string;
  timestamp?: boolean;
}

/**
 * Escape CSV field values according to RFC 4180
 */
function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return '';
  }

  let stringValue = String(field);

  if (stringValue.match(/^[=+\-@]/)) {
    stringValue = `'${stringValue}`;
  }
  // If field contains comma, quotes, or newline, wrap in quotes and escape quotes
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Get all unique column headers from array of objects
 * Handles rows with varying schemas
 */
function getAllHeaders(data: Record<string, unknown>[]): string[] {
  const headerSet = new Set<string>();

  for (const row of data) {
    Object.keys(row).forEach((key) => headerSet.add(key));
  }

  return Array.from(headerSet);
}

/**
 * Convert array of objects to CSV string with headers
 */
export function convertToCSV(data: unknown[], filename = 'export'): void {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('No data to export');
  }

  // Ensure all items are objects
  if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) {
    throw new Error('Data must be an array of objects');
  }

  // Get all unique column headers from all rows
  const headers = getAllHeaders(data as Record<string, unknown>[]);

  // Create CSV header row
  const headerRow = headers.map(escapeCSVField).join(',');

  // Create data rows
  const dataRows = data.map((row) => {
    const obj = row as Record<string, unknown>;
    return headers.map((header) => escapeCSVField(obj[header])).join(',');
  });

  // Combine header and data
  const csvContent = [headerRow, ...dataRows].join('\n');

  // Trigger download with UTF-8 BOM so Excel auto-detects encoding
  downloadFile('\uFEFF' + csvContent, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Convert data to JSON and trigger download
 * For flat table data with primitive values only
 */
export function convertToJSON(data: unknown[], filename = 'export'): void {
  if (!Array.isArray(data)) {
    throw new Error('Data must be an array');
  }

  const jsonContent = JSON.stringify(data, null, 2);

  downloadFile(jsonContent, `${filename}.json`, 'application/json;charset=utf-8;');
}

/**
 * Trigger file download
 */
function downloadFile(content: string, filename: string, mimeType: string): void {
  const element = document.createElement('a');
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';

  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}

/**
 * Get formatted filename with optional timestamp
 */
export function getExportFilename(baseName: string, options: ExportOptions = {}): string {
  const { timestamp = true } = options;

  if (!timestamp) {
    return baseName;
  }

  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');

  return `${baseName}_${date}_${time}`;
}
