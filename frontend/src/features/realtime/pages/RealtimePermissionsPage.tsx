import { useCallback, useMemo, useState } from 'react';
import {
  DataGridEmptyState,
  DataGrid,
  type ConvertedValue,
  type DataGridColumn,
  type DataGridRowType,
  EmptyState,
  TableHeader,
  SortableHeaderRenderer,
} from '@/components';
import { SQLModal, SQLCellButton } from '@/features/database';
import { useRealtimePermissions } from '../hooks/useRealtimePermissions';
import type { RlsPolicy } from '../services/realtime.service';
import { Tabs, Tab } from '@insforge/ui';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [sqlModal, setSqlModal] = useState({ open: false, title: '', value: '' });

  const {
    permissions,
    isLoadingPermissions: isLoading,
    permissionsError: error,
  } = useRealtimePermissions();

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const subscribePolicies = useMemo(
    () => (permissions ? mapPoliciesToRows(permissions.subscribe.policies) : []),
    [permissions]
  );

  const publishPolicies = useMemo(
    () => (permissions ? mapPoliciesToRows(permissions.publish.policies) : []),
    [permissions]
  );

  const activePolicies = activeTab === 'subscribe' ? subscribePolicies : publishPolicies;

  const filteredPolicies = searchQuery
    ? activePolicies.filter(
        (p) =>
          p.policyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.roles.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : activePolicies;

  const columns: DataGridColumn<PolicyRow>[] = useMemo(
    () => [
      {
        key: 'policyName',
        name: 'Policy Name',
        width: 'minmax(200px, 2fr)',
        resizable: true,
        sortable: true,
        renderHeaderCell: (props) => (
          <div className="flex h-full w-full items-center pl-2">
            <SortableHeaderRenderer
              column={props.column as DataGridColumn<PolicyRow>}
              sortDirection={props.sortDirection}
            />
          </div>
        ),
        renderCell: ({ row }) => (
          <div className="flex h-full w-full items-center pl-2">
            <span className="truncate text-foreground" title={row.policyName}>
              {row.policyName}
            </span>
          </div>
        ),
      },
      {
        key: 'command',
        name: 'Command',
        width: 'minmax(100px, 1fr)',
        resizable: true,
        sortable: true,
        renderCell: ({ row }) => (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-alpha-8 text-muted-foreground">
            {row.command}
          </span>
        ),
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
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        className="min-w-[800px]"
        leftContent={
          <div className="flex flex-1 items-center overflow-clip">
            <h1 className="shrink-0 text-base font-medium leading-7 text-foreground">
              Permissions
            </h1>
            <div className="flex h-5 w-5 shrink-0 items-center justify-center">
              <div className="h-5 w-px bg-[var(--alpha-8)]" />
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <Tab value="subscribe">Subscribe Policies</Tab>
              <Tab value="publish">Publish Policies</Tab>
            </Tabs>
          </div>
        }
        searchValue={searchQuery}
        onSearchChange={handleSearchChange}
        searchDebounceTime={300}
        searchPlaceholder="Search policies"
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <EmptyState title="Loading policies..." description="Please wait" />
          </div>
        ) : (
          <DataGrid
            data={filteredPolicies}
            columns={columns}
            showSelection={false}
            showPagination={false}
            noPadding={true}
            className="h-full"
            emptyState={
              <DataGridEmptyState
                message={
                  searchQuery ? 'No policies match your search criteria' : 'No policies found'
                }
              />
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
