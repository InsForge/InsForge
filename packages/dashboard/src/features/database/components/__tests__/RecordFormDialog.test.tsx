import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnSchema } from '@insforge/shared-schemas';

const createRecord = vi.fn().mockResolvedValue(undefined);

vi.mock('#features/database/hooks/useRecords', () => ({
  useRecords: () => ({ createRecord, isCreating: false }),
}));

import { RecordFormDialog } from '#features/database/components/RecordFormDialog';

function makeSchema(columnCount: number): ColumnSchema[] {
  const systemColumns: ColumnSchema[] = [
    { columnName: 'id', type: 'uuid', isNullable: false, isUnique: true, isPrimaryKey: true },
    { columnName: 'created_at', type: 'datetime', isNullable: false, isUnique: false },
    { columnName: 'updated_at', type: 'datetime', isNullable: false, isUnique: false },
  ];
  const editableColumns: ColumnSchema[] = Array.from({ length: columnCount }, (_, index) => ({
    columnName: `field_${index}`,
    type: 'string',
    isNullable: true,
    isUnique: false,
  }));
  return [...systemColumns, ...editableColumns];
}

describe('RecordFormDialog', () => {
  it('renders every editable column and filters system fields', () => {
    render(
      <RecordFormDialog
        open
        onOpenChange={vi.fn()}
        tableName="wide_table"
        schema={makeSchema(30)}
      />
    );

    for (let index = 0; index < 30; index += 1) {
      expect(screen.getByText(`field_${index}`)).toBeTruthy();
    }
    expect(screen.queryByText('id')).toBeNull();
    expect(screen.queryByText('created_at')).toBeNull();
    expect(screen.queryByText('updated_at')).toBeNull();
  });

  it('keeps footer actions reachable so a record can be submitted with many columns', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    createRecord.mockClear();

    render(
      <RecordFormDialog
        open
        onOpenChange={onOpenChange}
        tableName="wide_table"
        schema={makeSchema(40)}
        onSuccess={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Record' }));

    await waitFor(() => {
      expect(createRecord).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
