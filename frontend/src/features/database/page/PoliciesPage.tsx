import { useMemo, useState } from 'react';
import { useFullMetadata } from '../hooks/useFullMetadata';
import { SearchInput } from '@/components/SearchInput';
import { EmptyState } from '@/components/EmptyState';
import { DataGrid, type DataGridColumn, type DataGridRowType } from '@/components/datagrid';
import type { ExportDatabaseResponse, ExportDatabaseJsonData } from '@insforge/shared-schemas';
import type { ConvertedValue } from '@/components/datagrid/datagridTypes';
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

function parsePoliciesFromMetadata(metadata: ExportDatabaseResponse | undefined): PolicyRow[] {
  if (!metadata || metadata.format !== 'json' || typeof metadata.data === 'string') {
    return [];
  }

  const data = metadata.data as ExportDatabaseJsonData;
  const policies: PolicyRow[] = [];

  Object.entries(data.tables).forEach(([tableName, tableData]) => {
    if (isSystemTable(tableName)) {
      return;
    }

    tableData.policies.forEach((policy) => {
      policies.push({
        id: `${tableName}_${policy.policyname}`,
        tableName,
        policyName: policy.policyname,
        cmd: policy.cmd,
        roles: Array.isArray(policy.roles) ? policy.roles.join(', ') : String(policy.roles),
        qual: policy.qual,
        withCheck: policy.withCheck,
      });
    });
  });

  return policies;
}

export default function PoliciesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: metadata, isLoading, error } = useFullMetadata(true);

  const allPolicies = useMemo(() => parsePoliciesFromMetadata(metadata), [metadata]);

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
        renderCell: ({ row }) => {
          return <span className="text-xs font-mono">{row.qual || '-'}</span>;
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
    ],
    []
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
      <h1 className="text-xl font-normal text-zinc-950 dark:text-white">RLS Policies</h1>

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
            emptyState={
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {searchQuery ? 'No policies match your search criteria' : 'No policies found'}
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
