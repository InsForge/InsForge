import { DatabaseSidebar, type DatabaseSidebarProps } from './DatabaseSidebar';

export type TableSidebarProps = DatabaseSidebarProps;

export function TableSidebar(props: TableSidebarProps) {
  return <DatabaseSidebar {...props} />;
}
