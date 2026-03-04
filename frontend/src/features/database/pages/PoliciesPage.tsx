import { useMemo, useState } from 'react';
import RefreshIcon from '@/assets/icons/refresh.svg?react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { useNavigate } from 'react-router-dom';
import {
  DataGridEmptyState,
  DataGrid,
  type ConvertedValue,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  TableHeader,
} from '@/components';
import { usePolicies } from '../hooks/useDatabase';
import { SQLModal, SQLCellButton } from '../components/SQLModal';
import { DatabaseStudioMenuPanel } from '../components/DatabaseSecondaryMenu';
import type { DatabasePoliciesResponse } from '@insforge/shared-schemas';

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
  const navigate = useNavigate();
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
      <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
        <DatabaseStudioMenuPanel
          onBack={() =>
            void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
          }
        />
        <div className="min-w-0 flex-1 flex items-center justify-center bg-[rgb(var(--semantic-1))]">
          <EmptyState
            title="Failed to load policies"
            description={error instanceof Error ? error.message : 'An error occurred'}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioMenuPanel
        onBack={() =>
          void navigate('/dashboard/database/tables', { state: { slideFromStudio: true } })
        }
      />
      <div className="min-w-0 flex-1 flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
        <TableHeader
          title="RLS Policies"
          showDividerAfterTitle
          titleButtons={
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded p-1.5 text-muted-foreground hover:bg-[var(--alpha-4)] active:bg-[var(--alpha-8)]"
                    onClick={() => void handleRefresh()}
                    disabled={isRefreshing}
                  >
                    <RefreshIcon className={isRefreshing ? 'h-5 w-5 animate-spin' : 'h-5 w-5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center">
                  <p>{isRefreshing ? 'Refreshing...' : 'Refresh policies'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search policy"
        />
        {isLoading ? (
          <div className="min-h-0 flex-1 flex items-center justify-center">
            <EmptyState title="Loading policies..." description="Please wait" />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <DataGrid
              data={filteredPolicies}
              columns={columns}
              showSelection={false}
              showPagination={false}
              noPadding={true}
              className="h-full"
              isRefreshing={isRefreshing}
              emptyState={
                <DataGridEmptyState
                  message={
                    searchQuery ? 'No policies match your search criteria' : 'No policies found'
                  }
                />
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
    </div>
  );
}
