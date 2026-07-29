import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorageFileSchema } from '@insforge/shared-schemas';
import i18n from '#lib/i18n';
import { createStorageColumns } from '#features/storage/components/StorageDataGrid';

describe('createStorageColumns', () => {
  it('renders the full storage object key in the name column', () => {
    const columns = createStorageColumns(i18n.t);
    const nameColumn = columns.find((column) => column.key === 'key');
    const row: StorageFileSchema = {
      key: 'avatars/user-1/profile.png',
      bucket: 'images',
      size: 128,
      mimeType: 'image/png',
      uploadedAt: '2026-06-16T00:00:00.000Z',
      url: 'https://example.test/api/storage/buckets/images/objects/avatars%2Fuser-1%2Fprofile.png',
    };

    if (!nameColumn?.renderCell) {
      throw new Error('Expected the storage name column to define a cell renderer');
    }

    const cell = nameColumn.renderCell({
      row,
      column: nameColumn,
    } as Parameters<NonNullable<typeof nameColumn.renderCell>>[0]);

    render(<>{cell}</>);

    expect(screen.getByText('avatars/user-1/profile.png')).toBeInTheDocument();
    expect(screen.queryByText('profile.png')).not.toBeInTheDocument();
  });
});
