import { useMemo } from 'react';
import { User } from 'lucide-react';
import {
  Badge,
  Checkbox,
  DataGrid,
  createDefaultCellRenderer,
  type DataGridProps,
  type DataGridColumn,
  type RenderCellProps,
  type SelectionCellProps,
  ConvertedValue,
} from '@/components';
import { cn } from '@/lib/utils/utils';
import type { UserSchema } from '@insforge/shared-schemas';

// Create a type that makes UserSchema compatible with DataGrid requirements
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
      case 'x':
        return {
          label: 'X',
          color:
            'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-zinc-300 dark:border-gray-500',
        };
      case 'apple':
        return {
          label: 'Apple',
          color:
            'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-zinc-300 dark:border-gray-500',
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

const ProvidersCellRenderer = ({ row }: RenderCellProps<UserDataGridRow>) => {
  const providers = row.providers;

  if (!providers || !Array.isArray(providers) || !providers.length) {
    return <span className="text-sm text-black dark:text-zinc-300">null</span>;
  }

  // Get unique providers to avoid duplicates
  const uniqueProviders = [...new Set(providers)];

  return (
    <div className="flex flex-wrap gap-1" title={providers.join(', ')}>
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
      key: 'providers',
      name: 'Providers',
      width: '1fr',
      resizable: true,
      sortable: true,
      renderCell: ProvidersCellRenderer,
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
export type UsersDataGridProps = Omit<
  DataGridProps<UserDataGridRow>,
  'columns' | 'selectionColumnWidth' | 'renderSelectionCell'
>;

// Custom selection cell with avatar and name
const UserSelectionCell = ({
  row,
  isSelected,
  onToggle,
  tabIndex,
}: SelectionCellProps<UserDataGridRow>) => {
  const profile = row.profile as Record<string, unknown> | null;
  const avatarUrl = profile?.avatar_url as string | undefined;
  const name = profile?.name as string | undefined;

  return (
    <div className="flex items-center gap-2 w-full h-full">
      <Checkbox checked={isSelected} onChange={onToggle} tabIndex={tabIndex} />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={name || 'User avatar'}
            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-neutral-700 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-gray-500 dark:text-neutral-400" />
          </div>
        )}
        <span
          className={cn(
            'text-sm truncate',
            name ? 'text-black dark:text-zinc-300' : 'text-gray-400 dark:text-neutral-500'
          )}
          title={name || 'null'}
        >
          {name || 'null'}
        </span>
      </div>
    </div>
  );
};

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
      selectionColumnWidth={180}
      renderSelectionCell={UserSelectionCell}
    />
  );
}
