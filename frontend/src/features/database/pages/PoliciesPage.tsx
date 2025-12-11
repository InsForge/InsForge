import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import {
  Button,
  DataGrid,
  type ConvertedValue,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  SearchInput,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components';
import { usePolicies } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import type { DatabasePoliciesResponse } from '@insforge/shared-schemas';
import { isSystemTable } from '../constants';

interface PolicyRow extends DataGridRowType {
  id: string;
  tableName: string;
  policyName: string;
  cmd: string;
  roles: string;
  qual: string | null;
  withCheck: string | null;
  [key: string]: ConvertedValue | { [key: string]: string }[];
}

function parsePoliciesFromResponse(response: DatabasePoliciesResponse | undefined): PolicyRow[] {
  if (!response?.policies) {
    return [];
  }

  const policies: PolicyRow[] = [];

  response.policies.forEach((policy) => {
    if (isSystemTable(policy.tableName)) {
      return;
    }

    policies.push({
      id: `${policy.tableName}_${policy.policyName}`,
      tableName: policy.tableName,
      policyName: policy.policyName,
      cmd: policy.cmd,
      roles: Array.isArray(policy.roles) ? policy.roles.join(', ') : String(policy.roles),
      qual: policy.qual,
      withCheck: policy.withCheck,
    });
  });

  return policies;
}

export default function PoliciesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data, isLoading, error, refetch } = usePolicies(true);
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const allPolicies = useMemo(() => parsePoliciesFromResponse(data), [data]);

  const filteredPolicies = useMemo(() => {
    if (!searchQuery.trim()) {
      return allPolicies;
    }

    const query = searchQuery.toLowerCase();
    return allPolicies.filter(
      (policy) =>
        policy.policyName.toLowerCase().includes(query) ||
        policy.tableName.toLowerCase().includes(query)
    );
  }, [allPolicies, searchQuery]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      setSearchQuery('');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  const columns: DataGridColumn<PolicyRow>[] = useMemo(
    () => [
      {
        key: 'tableName',
        name: 'Table',
        width: 'minmax(180px, 1.5fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'policyName',
        name: 'Name',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
      },
      {
        key: 'cmd',
        name: 'Command',
        width: 'minmax(100px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => {
          const cmd = row.cmd;
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
        key: 'qual',
        name: 'Using',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.qual}
            onClick={() => row.qual && setSqlModal({ open: true, title: 'Using', value: row.qual })}
          />
        ),
      },
      {
        key: 'withCheck',
        name: 'With Check',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.withCheck}
            onClick={() =>
              row.withCheck &&
              setSqlModal({ open: true, title: 'With Check', value: row.withCheck })
            }
          />
        ),
      },
    ],
    [setSqlModal]
  );

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          title="Failed to load policies"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full p-4 bg-bg-gray dark:bg-neutral-800">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">RLS Policies</h1>

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

      <SearchInput
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder="Search for a policy"
        className="w-64"
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState title="Loading policies..." description="Please wait" />
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <DataGrid
            data={filteredPolicies}
            columns={columns}
            showSelection={false}
            showPagination={false}
            noPadding={true}
            className="h-full"
            isRefreshing={isRefreshing}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {searchQuery ? 'No policies match your search criteria' : 'No policies found'}
              </div>
            }
          />
        </div>
      )}

      {/* SQL Detail Modal */}
      <SQLModal
        open={sqlModal.open}
        onOpenChange={(open) => setSqlModal((prev) => ({ ...prev, open }))}
        title={sqlModal.title}
        value={sqlModal.value}
      />
    </div>
  );
}
