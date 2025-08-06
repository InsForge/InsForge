import { Table } from 'lucide-react';
import { FeatureSidebar } from '@/components/FeatureSidebar';
import { TableListSkeleton } from './TableListSkeleton';
import { TableEmptyState } from './TableEmptyState';

interface TableInfo {
  recordCount: number;
}

interface TableSidebarProps {
  tables: Record<string, TableInfo>;
  selectedTable?: string;
  onTableSelect: (tableName: string) => void;
  loading?: boolean;
  onNewTable?: () => void;
  onEditTable?: (table: string) => void;
  onDeleteTable?: (table: string) => void;
}

export function TableSidebar({
  tables,
  selectedTable,
  onTableSelect,
  loading,
  onNewTable,
  onEditTable,
  onDeleteTable,
}: TableSidebarProps) {
  return (
    <FeatureSidebar
      title="Database"
      items={tables}
      selectedItem={selectedTable}
      onItemSelect={onTableSelect}
      loading={loading}
      onNewItem={onNewTable}
      onEditItem={onEditTable}
      onDeleteItem={onDeleteTable}
      searchPlaceholder="Search tables..."
      newItemTooltip="Create New Table"
      editLabel="Edit Table"
      deleteLabel="Delete Table"
      icon={Table}
      filterItems={(tableNames) =>
        tableNames.filter((name) => name !== 'auth' && name !== 'profiles' && name !== 'identifies')
      }
      renderSkeleton={() => <TableListSkeleton />}
      renderEmptyState={(searchTerm) => <TableEmptyState searchTerm={searchTerm} />}
    />
  );
}
