import { useMemo } from 'react';
import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import {
  staticMenuItems,
  documentationMenuItem,
  usageMenuItem,
  settingsMenuItem,
  deploymentsMenuItem,
  type PrimaryMenuItem,
} from '@/lib/utils/menuItems';
import { useLocation, matchPath } from 'react-router-dom';
import { isInsForgeCloudProject, isIframe } from '@/lib/utils/utils';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AppSidebar({ isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { menuItems: logsMenuItems, isLoading: logsLoading } = useLogSources();

  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();

  // Build main menu items - add deployments for cloud projects
  const mainMenuItems = useMemo(() => {
    if (isCloud) {
      // Insert deployments after visualizer (at the end of main items)
      return [...staticMenuItems, deploymentsMenuItem];
    }
    return staticMenuItems;
  }, [isCloud]);

  // Build bottom menu items based on deployment environment
  const bottomMenuItems = useMemo(() => {
    const items: PrimaryMenuItem[] = [];

    // Only show Usage when in iframe (postMessage to parent works)
    if (isCloud && isInIframe) {
      items.push(usageMenuItem);
    }

    items.push(documentationMenuItem);
    items.push(settingsMenuItem);
    return items;
  }, [isCloud, isInIframe]);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = useMemo(() => {
    const allItems = [...mainMenuItems, ...bottomMenuItems];
    return allItems.find((item) => {
      if (item.external || item.onClick) {
        return false;
      }
      const hasSecondaryMenu = !!item.secondaryMenu || item.id === 'logs';
      return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
    });
  }, [mainMenuItems, bottomMenuItems, pathname]);

  // Get secondary menu items (special case for logs)
  const secondaryMenuItems = activeMenu?.id === 'logs' ? logsMenuItems : activeMenu?.secondaryMenu;
  const isLoading = activeMenu?.id === 'logs' ? logsLoading : false;

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
      {secondaryMenuItems && activeMenu && (
        <SecondaryMenu title={activeMenu.label} items={secondaryMenuItems} loading={isLoading} />
      )}
    </div>
  );
}
