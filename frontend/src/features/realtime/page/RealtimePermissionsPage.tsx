import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  DataGrid,
  type ConvertedValue,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { realtimeService, type RlsPolicy } from '../services/realtime.service';

interface PolicyRow extends DataGridRowType {
  id: string;
  policyName: string;
  tableName: string;
  command: string;
  roles: string;
  using: string | null;
  withCheck: string | null;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function mapPoliciesToRows(policies: RlsPolicy[]): PolicyRow[] {
  return policies.map((policy, index) => ({
    id: `${policy.tableName}_${policy.policyName}_${index}`,
    policyName: policy.policyName,
    tableName: policy.tableName,
    command: policy.command,
    roles: Array.isArray(policy.roles) ? policy.roles.join(', ') : String(policy.roles),
    using: policy.using,
    withCheck: policy.withCheck,
  }));
}

const columns: DataGridColumn<PolicyRow>[] = [
  {
    key: 'policyName',
    name: 'Policy Name',
    width: 'minmax(200px, 2fr)',
    resizable: true,
    sortable: true,
  },
  {
    key: 'command',
    name: 'Command',
    width: 'minmax(100px, 1fr)',
    resizable: true,
    sortable: true,
    renderCell: ({ row }) => {
      const cmd = row.command;
      const cmdLabel = cmd === '*' ? 'ALL' : cmd;
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
          {cmdLabel}
        </span>
      );
    },
  },
  {
    key: 'roles',
    name: 'Roles',
    width: 'minmax(150px, 1.5fr)',
    resizable: true,
  },
  {
    key: 'using',
    name: 'Using',
    width: 'minmax(200px, 2fr)',
    resizable: true,
    renderCell: ({ row }) => {
      return <span className="text-xs font-mono">{row.using || '-'}</span>;
    },
  },
  {
    key: 'withCheck',
    name: 'With Check',
    width: 'minmax(200px, 2fr)',
    resizable: true,
    renderCell: ({ row }) => {
      return <span className="text-xs font-mono">{row.withCheck || '-'}</span>;
    },
  },
];

interface PolicySectionProps {
  title: string;
  description: string;
  policies: PolicyRow[];
  isRefreshing: boolean;
}

function PolicySection({ title, description, policies, isRefreshing }: PolicySectionProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-white">{title}</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <div className="overflow-hidden">
        <DataGrid
          data={policies}
          columns={columns}
          showSelection={false}
          showPagination={false}
          noPadding={true}
          className="h-full"
          isRefreshing={isRefreshing}
          emptyState={
            <div className="text-sm text-zinc-500 dark:text-zinc-400">No policies defined</div>
          }
        />
      </div>
    </div>
  );
}

export default function RealtimePermissionsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: permissions,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['realtime', 'permissions'],
    queryFn: () => realtimeService.getPermissions(),
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const subscribePolicies = permissions ? mapPoliciesToRows(permissions.subscribe.policies) : [];
  const publishPolicies = permissions ? mapPoliciesToRows(permissions.publish.policies) : [];

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="Failed to load permissions"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 h-full p-4 bg-bg-gray dark:bg-neutral-800 overflow-auto">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Permissions</h1>

        {/* Separator */}
        <div className="h-6 w-px bg-gray-200 dark:bg-neutral-700" />

        {/* Refresh button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="p-1 h-9 w-9"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
              >
                <RefreshIcon className="h-5 w-5 text-zinc-400 dark:text-neutral-400" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="center">
              <p>{isRefreshing ? 'Refreshing...' : 'Refresh'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Loading permissions..." description="Please wait" />
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <PolicySection
            title="Subscribe Policies"
            description="RLS policies on realtime.channels table control who can subscribe to channels (SELECT permission)."
            policies={subscribePolicies}
            isRefreshing={isRefreshing}
          />

          <PolicySection
            title="Publish Policies"
            description="RLS policies on realtime.messages table control who can publish messages (INSERT permission)."
            policies={publishPolicies}
            isRefreshing={isRefreshing}
          />
        </div>
      )}
    </div>
  );
}
