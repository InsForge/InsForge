import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  request: vi.fn(),
  withAccessToken: vi.fn(() => ({ Authorization: 'Bearer token' })),
}));

const dataExportMock = vi.hoisted(() => ({
  convertToCSV: vi.fn(),
  getExportFilename: vi.fn((name: string) => `${name}.csv`),
}));

vi.mock('#lib/api/client', () => ({
  apiClient: apiClientMock,
}));

vi.mock('#lib/utils/data-export', () => dataExportMock);

import { recordService } from '#features/database/services/record.service';

function makeRecords(count: number, startId: number) {
  return Array.from({ length: count }, (_, i) => ({ id: startId + i }));
}

describe('recordService.exportTableAsCSV', () => {
  beforeEach(() => {
    apiClientMock.request.mockReset();
    dataExportMock.convertToCSV.mockReset();
  });

  it('is not marked limited when the table has exactly MAX_EXPORT_ROWS rows', async () => {
    // 10,000 rows fetched in pages of 500 (20 full pages, evenly divides the
    // cap) with pagination.total reporting the true, non-truncated count.
    let offset = 0;
    apiClientMock.request.mockImplementation(() => {
      const remaining = 10_000 - offset;
      const pageSize = Math.min(500, remaining);
      const data = pageSize > 0 ? makeRecords(pageSize, offset) : [];
      offset += pageSize;
      return Promise.resolve({ data, pagination: { offset, limit: 500, total: 10_000 } });
    });

    const result = await recordService.exportTableAsCSV('users', 'public');

    expect(result.limited).toBe(false);
    expect(dataExportMock.convertToCSV).toHaveBeenCalledTimes(1);
    expect(dataExportMock.convertToCSV.mock.calls[0][0]).toHaveLength(10_000);
  });

  it('is marked limited when the table has more than MAX_EXPORT_ROWS rows, even on a page-aligned boundary', async () => {
    // 10,500 rows: page size (500) divides the cap (10,000) evenly, so every
    // fetched page is "full" right up to the cap. A page-size-based check
    // would miss the truncation here; pagination.total should catch it.
    let offset = 0;
    apiClientMock.request.mockImplementation(() => {
      const data = makeRecords(500, offset);
      offset += 500;
      return Promise.resolve({ data, pagination: { offset, limit: 500, total: 10_500 } });
    });

    const result = await recordService.exportTableAsCSV('users', 'public');

    expect(result.limited).toBe(true);
    expect(dataExportMock.convertToCSV.mock.calls[0][0]).toHaveLength(10_000);
  });
});
