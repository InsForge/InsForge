import { useMemo } from 'react';
import {
  DataGrid,
  createDefaultCellRenderer,
  type DataGridProps,
  type DataGridColumn,
  type RenderCellProps,
  ConvertedValue,
} from '@/components/datagrid';
import { Badge } from '@/components/radix/Badge';
import { cn } from '@/lib/utils/utils';
import type { UserSchema } from '@insforge/shared-schemas';

// Create a type that makes UserSchema compatible with DataGrid requirements
// We bypass the strict DatabaseRecord constraint since UserSchema has its own structure
type UserDataGridRow = UserSchema & {
  [key: string]: ConvertedValue | { [key: string]: string }[];
};

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
      case 'discord':
        return {
          label: 'Discord',
          color:
            'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-zinc-300 dark:border-gray-500',
        };
      case 'linkedin':
        return {
          label: 'LinkedIn',
          color:
            'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-500',
        };
      case 'facebook':
        return {
          label: 'Facebook',
          color:
            'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-600',
        };
      case 'microsoft':
        return {
          label: 'Microsoft',
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

const IdentitiesCellRenderer = ({ row }: RenderCellProps<UserDataGridRow>) => {
  const identities = row.identities;

  if (!identities || !Array.isArray(identities) || !identities.length) {
    return <span className="text-sm text-black dark:text-zinc-300">null</span>;
  }

  // Get unique providers to avoid duplicates
  const uniqueProviders = [
    ...new Set(identities.map((identity: { provider: string }) => identity.provider)),
  ];

  return (
    <div
      className="flex flex-wrap gap-1"
      title={identities.map((identity: { provider: string }) => identity.provider).join(', ')}
    >
      {uniqueProviders.slice(0, 2).map((provider: string, index: number) => (
        <ProviderIcon key={index} provider={provider} />
      ))}
      {uniqueProviders.length > 2 && (
        <Badge
          variant="secondary"
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-zinc-300 dark:border-neutral-700 border border-transparent"
        >
          +{uniqueProviders.length - 2}
        </Badge>
      )}
    </div>
  );
};

// Convert users data to DataGrid columns
export function createUsersColumns(): DataGridColumn<UserDataGridRow>[] {
  const cellRenderers = createDefaultCellRenderer<UserDataGridRow>();

  return [
    {
      key: 'id',
      name: 'ID',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.id,
    },
    {
      key: 'email',
      name: 'Email',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.email,
    },
    {
      key: 'name',
      name: 'Name',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.text,
    },
    {
      key: 'identities',
      name: 'Identities',
      width: '1.5fr',
      resizable: true,
      sortable: true,
      renderCell: IdentitiesCellRenderer,
    },
    {
      key: 'providerType',
      name: 'Provider Type',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.text,
    },
    {
      key: 'emailVerified',
      name: 'Email Verified',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.boolean,
    },
    {
      key: 'createdAt',
      name: 'Created',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.datetime,
    },
    {
      key: 'updatedAt',
      name: 'Updated',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: cellRenderers.datetime,
    },
  ];
}

// Users-specific DataGrid props
export type UsersDataGridProps = Omit<DataGridProps<UserDataGridRow>, 'columns'>;

// Specialized DataGrid for users
export function UsersDataGrid(props: UsersDataGridProps) {
  const columns = useMemo(() => createUsersColumns(), []);

  return (
    <DataGrid<UserDataGridRow>
      {...props}
      columns={columns}
      showSelection={true}
      showPagination={true}
      showTypeBadge={false}
    />
  );
}
