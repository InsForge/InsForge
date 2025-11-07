import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import { getMenuItems, getBottomMenuItems } from '@/lib/utils/menuConfig';
import { useLocation, matchPath } from 'react-router-dom';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  onLogout: () => void;
}

export default function AppSidebar({ onLogout: _onLogout }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { hasCompletedOnboarding } = useMcpUsage();
  const { menuItems: logsMenuItems, isLoading: logsLoading } = useLogSources();
  const menuItems = getMenuItems(hasCompletedOnboarding);
  const bottomMenuItems = getBottomMenuItems(hasCompletedOnboarding);

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
      <PrimaryMenu items={menuItems} bottomItems={bottomMenuItems} activeItemId={activeMenu?.id} />

      {/* Render the secondary menu */}
      {secondaryMenuItems && activeMenu && (
        <SecondaryMenu title={activeMenu.label} items={secondaryMenuItems} loading={isLoading} />
      )}
    </div>
  );
}
