import { useMemo } from 'react';
import {
  DataGrid,
  DefaultCellRenderers,
  type DataGridColumn,
  type DataGridProps,
} from '@/components/DataGrid';
import { Badge } from '@/components/radix/Badge';
import { cn } from '@/lib/utils/utils';

// Provider icon component
const ProviderIcon = ({ provider }: { provider: string }) => {
  const getProviderInfo = (provider: string) => {
    switch (provider.toLowerCase()) {
      case 'google':
        return { label: 'Google', color: 'bg-red-100 text-red-700' };
      case 'github':
        return { label: 'GitHub', color: 'bg-gray-100 text-gray-700' };
      case 'discord':
        return { label: 'Discord', color: 'bg-blue-100 text-blue-700' };
      case 'email':
        return { label: 'Email', color: 'bg-green-100 text-green-700' };
      default:
        return { label: provider, color: 'bg-gray-100 text-gray-700' };
    }
  };

  const { label, color } = getProviderInfo(provider);

  return (
    <Badge variant="secondary" className={cn('text-xs font-medium px-2 py-1', color)}>
      {label}
    </Badge>
  );
};

// Custom cell renderers for users
const NameCellRenderer = ({ row, column }: any) => (
  <span className="text-sm text-gray-800 truncate" title={row[column.key] || 'null'}>
    {row[column.key] || 'null'}
  </span>
);

const IdentitiesCellRenderer = ({ row, column }: any) => {
  const identities = row[column.key];

  if (!identities || !Array.isArray(identities) || identities.length === 0) {
    return <span className="text-sm text-black">null</span>;
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
        <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600">
          +{uniqueProviders.length - 2}
        </Badge>
      )}
    </div>
  );
};

const ProviderTypeCellRenderer = ({ row, column }: any) => (
  <span className="text-sm text-black truncate" title={row[column.key] || 'null'}>
    {row[column.key] || 'null'}
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
export type UsersDataGridProps = Omit<DataGridProps, 'columns'>;

// Specialized DataGrid for users
export function UsersDataGrid({
  emptyStateTitle = 'No users available',
  emptyStateDescription,
  emptyStateActionText,
  onEmptyStateAction,
  ...props
}: UsersDataGridProps) {
  const columns = useMemo(() => createUsersColumns(), []);

  const defaultEmptyDescription = props.searchQuery
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
      storageKey="users"
    />
  );
}
