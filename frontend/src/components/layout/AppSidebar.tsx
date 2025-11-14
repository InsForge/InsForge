import { useMemo } from 'react';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import {
  staticMenuItems,
  getStartedMenuItem,
  documentationMenuItem,
  reinstallMenuItem,
  settingsMenuItem,
  usageMenuItem,
} from '@/lib/utils/menuItems';
import { useLocation, matchPath } from 'react-router-dom';
import { isInsForgeCloudProject } from '@/lib/utils/utils';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AppSidebar({ isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { hasCompletedOnboarding, isLoading: onboardingLoading } = useMcpUsage();
  const { menuItems: logsMenuItems, isLoading: logsLoading } = useLogSources();

  // Add "Get Started" item when user hasn't completed onboarding
  const menuItems = useMemo(() => {
    // While loading or if onboarding complete, show default menu
    if (onboardingLoading || hasCompletedOnboarding || isInsForgeCloudProject()) {
      return staticMenuItems;
    }
    return [getStartedMenuItem, ...staticMenuItems];
  }, [hasCompletedOnboarding, onboardingLoading]);

  // Build bottom menu items based on user state
  const bottomMenuItems = useMemo(() => {
    const items = [];

    if (isInsForgeCloudProject()) {
      items.push(usageMenuItem);
    }

    items.push(documentationMenuItem);

    // Add reinstall button if onboarding is completed
    if (hasCompletedOnboarding && !isInsForgeCloudProject()) {
      items.push(reinstallMenuItem);
    }

    // Add settings button if this is an InsForge Cloud project
    if (isInsForgeCloudProject()) {
      items.push(settingsMenuItem);
    }

    return items;
  }, [hasCompletedOnboarding]);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = menuItems.find((item) => {
    const hasSecondaryMenu = !!item.secondaryMenu || item.id === 'logs';
    return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
  });

  // Get secondary menu items (special case for logs)
  const secondaryMenuItems = activeMenu?.id === 'logs' ? logsMenuItems : activeMenu?.secondaryMenu;
  const isLoading = activeMenu?.id === 'logs' ? logsLoading : false;

  return (
    <div className="flex h-full">
      <PrimaryMenu
        items={menuItems}
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
