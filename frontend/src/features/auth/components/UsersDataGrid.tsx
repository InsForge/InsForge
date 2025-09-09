import { useMemo } from 'react';
import {
  DataGrid,
  DefaultCellRenderers,
  type DataGridProps,
  type DataGridColumn,
  type DataGridRow,
  type RenderCellProps,
} from '@/components/datagrid';
import { Badge } from '@/components/radix/Badge';
import { cn } from '@/lib/utils/utils';

// Provider icon component
const ProviderIcon = ({ provider }: { provider: string }) => {
  const getProviderInfo = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'google':
        return {
          label: 'Google',
          color:
            'bg-red-100 text-red-700 dark:bg-neutral-800 dark:text-red-300 dark:border-red-500',
        };
      case 'github':
        return {
          label: 'GitHub',
          color:
            'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-zinc-300 dark:border-gray-500',
        };
      case 'email':
        return {
          label: 'Email',
          color:
            'bg-green-100 text-green-700 dark:bg-neutral-800 dark:text-green-300 dark:border-green-500',
        };
      default:
        return {
          label: provider,
          color:
            'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-zinc-300 dark:border-gray-500',
        };
    }
  };

  const { label, color } = getProviderInfo(provider);

  return (
    <Badge
      variant="secondary"
      className={cn('text-xs font-medium px-2 py-1 border border-transparent', color)}
    >
      {label}
    </Badge>
  );
};

// Custom cell renderers for users
const NameCellRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => (
  <span
    className="text-sm text-gray-800 dark:text-zinc-300 truncate"
    title={String(row[column.key] || 'null')}
  >
    {String(row[column.key] || 'null')}
  </span>
);

const IdentitiesCellRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => {
  const identities = row[column.key];

  if (!identities || !Array.isArray(identities) || identities.length === 0) {
    return <span className="text-sm text-black dark:text-zinc-300">null</span>;
  }

  // Get unique providers to avoid duplicates
  const uniqueProviders = [...new Set(identities.map((identity: any) => identity.provider))];

  return (
    <div
      className="flex flex-wrap gap-1"
      title={identities.map((identity: any) => identity.provider).join(', ')}
    >
      {uniqueProviders.slice(0, 2).map((provider: string, index: number) => (
        <ProviderIcon key={index} provider={provider} />
      ))}
      {uniqueProviders.length > 2 && (
        <Badge
          variant="secondary"
          className="text-xs bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700"
        >
          +{uniqueProviders.length - 2}
        </Badge>
      )}
    </div>
  );
};

const ProviderTypeCellRenderer = ({ row, column }: RenderCellProps<DataGridRow>) => (
  <span
    className="text-sm text-black dark:text-zinc-300 truncate"
    title={String(row[column.key] || 'null')}
  >
    {String(row[column.key] || 'null')}
  </span>
);

// Convert users data to DataGrid columns
export function createUsersColumns(): DataGridColumn[] {
  return [
    {
      key: 'id',
      name: 'ID',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: DefaultCellRenderers.id,
    },
    {
      key: 'email',
      name: 'Email',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: DefaultCellRenderers.email,
    },
    {
      key: 'name',
      name: 'Name',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: NameCellRenderer,
    },
    {
      key: 'identities',
      name: 'Identities',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: IdentitiesCellRenderer,
    },
    {
      key: 'provider_type',
      name: 'Provider Type',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: ProviderTypeCellRenderer,
    },
    {
      key: 'created_at',
      name: 'Created',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: DefaultCellRenderers.date,
    },
    {
      key: 'updated_at',
      name: 'Updated',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: DefaultCellRenderers.date,
    },
  ];
}

// Users-specific DataGrid props
export type UsersDataGridProps = Omit<DataGridProps, 'columns'> & {
  searchQuery?: string;
};

// Specialized DataGrid for users
export function UsersDataGrid({
  searchQuery,
  emptyStateTitle = 'No users available',
  emptyStateDescription,
  emptyStateActionText,
  onEmptyStateAction,
  ...props
}: UsersDataGridProps) {
  const columns = useMemo(() => createUsersColumns(), []);

  const defaultEmptyDescription = searchQuery
    ? 'No users match your search criteria'
    : 'No users have been created yet';

  return (
    <DataGrid
      {...props}
      columns={columns}
      emptyStateTitle={emptyStateTitle}
      emptyStateDescription={emptyStateDescription || defaultEmptyDescription}
      emptyStateActionText={emptyStateActionText}
      onEmptyStateAction={onEmptyStateAction}
      showSelection={true}
      showPagination={true}
      showTypeBadge={false}
    />
  );
}
