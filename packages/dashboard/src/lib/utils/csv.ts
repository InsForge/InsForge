/**
 * Converts records to CSV format with proper escaping
 */
export function convertToCSV(records: Record<string, unknown>[], filename: string): void {
  if (records.length === 0) {
    return;
  }

  // Get headers from first record
  const headers = Object.keys(records[0]);

  // Create CSV header row
  const csvHeader = headers.map(escapeCSVField).join(',');

  // Create CSV data rows
  const csvRows = records.map((record) =>
    headers.map((header) => escapeCSVField(record[header])).join(',')
  );

  // Combine header and rows
  const csv = [csvHeader, ...csvRows].join('\n');

  // Create blob and download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadFile(blob, filename);
}

/**
 * Escapes CSV field values to handle commas, quotes, and newlines
 */
function escapeCSVField(field: unknown): string {
  if (field === null || field === undefined) {
    return '';
  }

  let value = String(field);

  // If field contains comma, newline, or double quote, wrap in quotes and escape inner quotes
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    value = `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

/**
 * Triggers file download in the browser
 */
function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
