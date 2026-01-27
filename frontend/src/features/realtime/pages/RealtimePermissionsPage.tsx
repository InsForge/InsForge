import { useMemo, useState } from 'react';
import {
  DataGrid,
  type ConvertedValue,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
} from '@/components';
import { SQLModal, SQLCellButton } from '@/features/database';
import { useRealtimePermissions } from '../hooks/useRealtimePermissions';
import type { RlsPolicy } from '../services/realtime.service';
import { cn } from '@/lib/utils/utils';

type TabType = 'subscribe' | 'publish';

interface PolicyRow extends DataGridRowType {
  id: string;
  policyName: string;
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
    command: policy.command === '*' ? 'ALL' : policy.command,
    roles: Array.isArray(policy.roles) ? policy.roles.join(', ') : String(policy.roles),
    using: policy.using,
    withCheck: policy.withCheck,
  }));
}

export default function RealtimePermissionsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('subscribe');
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const {
    permissions,
    isLoadingPermissions: isLoading,
    permissionsError: error,
  } = useRealtimePermissions();

  const subscribePolicies = useMemo(
    () => (permissions ? mapPoliciesToRows(permissions.subscribe.policies) : []),
    [permissions]
  );

  const publishPolicies = useMemo(
    () => (permissions ? mapPoliciesToRows(permissions.publish.policies) : []),
    [permissions]
  );

  const activePolicies = activeTab === 'subscribe' ? subscribePolicies : publishPolicies;

  const columns: DataGridColumn<PolicyRow>[] = useMemo(
    () => [
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
          return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs font-medium bg-slate-600 text-white">
              {row.command}
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
        renderCell: ({ row }) => (
          <SQLCellButton
            value={row.using}
            onClick={() =>
              row.using && setSqlModal({ open: true, title: 'Using', value: row.using })
            }
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
          title="Failed to load permissions"
          description={error instanceof Error ? error.message : 'An error occurred'}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Fixed Header */}
      <div className="shrink-0 bg-bg-gray dark:bg-neutral-800 p-4 flex flex-col gap-6">
        {/* Title */}
        <h1 className="text-xl font-normal text-zinc-950 dark:text-white">Permissions</h1>

        {/* Tabs */}
        <div className="flex gap-6 items-start">
          <button
            onClick={() => setActiveTab('subscribe')}
            className={cn(
              'h-8 text-sm font-medium transition-colors',
              activeTab === 'subscribe'
                ? 'text-zinc-950 dark:text-white border-b-2 border-zinc-950 dark:border-white'
                : 'text-zinc-500 dark:text-neutral-400 hover:text-zinc-700 dark:hover:text-neutral-300'
            )}
          >
            Subscribe Policies
          </button>
          <button
            onClick={() => setActiveTab('publish')}
            className={cn(
              'h-8 text-sm font-medium transition-colors',
              activeTab === 'publish'
                ? 'text-zinc-950 dark:text-white border-b-2 border-zinc-950 dark:border-white'
                : 'text-zinc-500 dark:text-neutral-400 hover:text-zinc-700 dark:hover:text-neutral-300'
            )}
          >
            Publish Policies
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 pb-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState title="Loading policies..." description="Please wait" />
          </div>
        ) : (
          <DataGrid
            data={activePolicies}
            columns={columns}
            showSelection={false}
            showPagination={false}
            noPadding={true}
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">No policies defined</div>
            }
          />
        )}
      </div>

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
