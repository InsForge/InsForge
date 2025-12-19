import { Table } from 'lucide-react';
import { FeatureSidebar } from '@/components/FeatureSidebar';
import { TableListSkeleton } from './TableListSkeleton';
import { TableEmptyState } from './TableEmptyState';

interface TableSidebarProps {
  tables: string[];
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
      title="Tables"
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
      renderSkeleton={() => <TableListSkeleton />}
      renderEmptyState={(searchTerm) => <TableEmptyState searchTerm={searchTerm} />}
    />
  );
}
