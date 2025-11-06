import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import { getMenuItems, bottomMenuItems } from '@/lib/utils/menuConfig';
import { useLocation, matchPath } from 'react-router-dom';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  onLogout: () => void;
}

export default function AppSidebar({ onLogout: _onLogout }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { hasCompletedOnboarding } = useMcpUsage();
  const menuItems = getMenuItems(hasCompletedOnboarding);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = menuItems.find((item) => {
    const hasSecondaryMenu = !!item.secondaryMenu;
    return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
  });

  return (
    <div className="flex h-full">
      <PrimaryMenu items={menuItems} bottomItems={bottomMenuItems} activeItemId={activeMenu?.id} />

      {activeMenu?.secondaryMenu && (
        <SecondaryMenu title={activeMenu.label} items={activeMenu.secondaryMenu} />
      )}
    </div>
  );
}
