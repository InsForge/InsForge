import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TableHeader } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useToast } from '#lib/hooks/useToast';
import { datasourceQueryKeys } from '#features/datasource/hooks/useDatasource';
import { DatasourceCatalog } from './DatasourceCatalog';

export default function DatasourceLayout() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { subscribeApifyConnectionStatus } = useDashboardHost();
  const [search, setSearch] = useState('');

  // OAuth completes in the parent cloud shell, which posts the result back here.
  useEffect(() => {
    if (!subscribeApifyConnectionStatus) {
      return;
    }
    return subscribeApifyConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: datasourceQueryKeys.all });
        showToast('Apify connected.', 'info');
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? `Apify connection failed: ${e.reason}`
            : 'Apify connection failed. Please try again.',
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast('Apify connection cancelled.', 'info');
      }
    });
  }, [qc, showToast, subscribeApifyConnectionStatus]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <TableHeader
        title="Data Sources"
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search data sources"
      />
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-[1200px]">
          <DatasourceCatalog query={search} />
        </div>
      </div>
    </div>
  );
}
