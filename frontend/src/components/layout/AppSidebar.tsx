import { useMemo } from 'react';
import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import {
  staticMenuItems,
  settingsMenuItem,
  deploymentsMenuItem,
  type PrimaryMenuItem,
} from '@/lib/utils/menuItems';
import { useLocation, matchPath } from 'react-router-dom';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import { useModal } from '@/lib/contexts/ModalContext';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AppSidebar({ isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { menuItems: logsMenuItems, isLoading: logsLoading } = useLogSources();
  const { openSettingsDialog } = useModal();

  const isCloud = isInsForgeCloudProject();

  // Build main menu items - insert deployments at the end of section 2 for cloud projects
  const mainMenuItems = useMemo(() => {
    const items = staticMenuItems.map((item) => ({ ...item }));

    if (isCloud) {
      const aiItemIndex = items.findIndex((item) => item.id === 'ai');
      const deploymentsItem: PrimaryMenuItem = { ...deploymentsMenuItem, sectionEnd: true };

      if (aiItemIndex >= 0) {
        items[aiItemIndex] = { ...items[aiItemIndex], sectionEnd: false };
        items.splice(aiItemIndex + 1, 0, deploymentsItem);
        return items;
      }

      return [...items, deploymentsItem];
    }

    return items;
  }, [isCloud]);

  // Build bottom menu items based on deployment environment
  const bottomMenuItems = useMemo(() => {
    const items: PrimaryMenuItem[] = [];
    items.push({ ...settingsMenuItem, onClick: () => openSettingsDialog() });
    return items;
  }, [openSettingsDialog]);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = useMemo(() => {
    const allItems = [...mainMenuItems, ...bottomMenuItems];
    return allItems.find((item) => {
      if (item.external || item.onClick) {
        return false;
      }

      // Keep Authentication menu active for all authentication pages.
      if (item.id === 'authentication') {
        return !!matchPath({ path: '/dashboard/authentication', end: false }, pathname);
      }

      const hasSecondaryMenu = !!item.secondaryMenu || item.id === 'logs';
      return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
    });
  }, [mainMenuItems, bottomMenuItems, pathname]);

  // Get secondary menu items (special case for logs)
  const secondaryMenuItems = activeMenu?.id === 'logs' ? logsMenuItems : activeMenu?.secondaryMenu;
  const isLoading = activeMenu?.id === 'logs' ? logsLoading : false;
  const hideSecondaryMenu =
    activeMenu?.id === 'database' &&
    !!matchPath({ path: '/dashboard/database', end: false }, pathname);

  return (
    <div className="flex h-full">
      <PrimaryMenu
        items={mainMenuItems}
        bottomItems={bottomMenuItems}
        activeItemId={activeMenu?.id}
        isCollapsed={isCollapsed}
        onToggleCollapse={onToggleCollapse}
      />

      {/* Render the secondary menu - always visible when there are items */}
      {secondaryMenuItems && activeMenu && !hideSecondaryMenu && (
        <SecondaryMenu title={activeMenu.label} items={secondaryMenuItems} loading={isLoading} />
      )}
    </div>
  );
}
