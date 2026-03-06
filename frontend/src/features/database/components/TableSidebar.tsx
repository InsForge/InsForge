import { DatabaseSecondaryMenu, type DatabaseSecondaryMenuProps } from './DatabaseSecondaryMenu';

export type TableSidebarProps = DatabaseSecondaryMenuProps;

export function TableSidebar(props: TableSidebarProps) {
  return <DatabaseSecondaryMenu {...props} />;
}
