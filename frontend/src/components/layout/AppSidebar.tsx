import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import { getMenuItems, getBottomMenuItems, SecondaryMenuItem } from '@/lib/utils/menuConfig';
import { useLocation, matchPath } from 'react-router-dom';
import { useState, useCallback } from 'react';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  onLogout: () => void;
}

export default function AppSidebar({ onLogout: _onLogout }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { hasCompletedOnboarding } = useMcpUsage();
  const menuItems = getMenuItems(hasCompletedOnboarding);
  const bottomMenuItems = getBottomMenuItems(hasCompletedOnboarding);

  // State for dynamic menu items
  const [dynamicItems, setDynamicItems] = useState<SecondaryMenuItem[]>([]);
  const [isLoadingDynamic, setIsLoadingDynamic] = useState(false);

  // Callbacks for dynamic menu components
  const handleItemsChange = useCallback((items: SecondaryMenuItem[]) => {
    setDynamicItems(items);
  }, []);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setIsLoadingDynamic(loading);
  }, []);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = menuItems.find((item) => {
    const hasSecondaryMenu = !!item.secondaryMenu;
    return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
  });

  // Determine if we're rendering a dynamic or static secondary menu
  const secondaryMenuConfig = activeMenu?.secondaryMenu;
  const isDynamicMenu =
    secondaryMenuConfig && typeof secondaryMenuConfig === 'object' && 'type' in secondaryMenuConfig;

  return (
    <div className="flex h-full">
      <PrimaryMenu items={menuItems} bottomItems={bottomMenuItems} activeItemId={activeMenu?.id} />

      {/* Render dynamic menu component (invisible, just manages state) */}
      {isDynamicMenu && secondaryMenuConfig.type === 'dynamic' && (
        <secondaryMenuConfig.component
          onItemsChange={handleItemsChange}
          onLoading={handleLoadingChange}
        />
      )}

      {/* Render the secondary menu with either static or dynamic items */}
      {secondaryMenuConfig && (
        <SecondaryMenu
          title={activeMenu.label}
          items={isDynamicMenu ? dynamicItems : (secondaryMenuConfig as SecondaryMenuItem[])}
          loading={isDynamicMenu ? isLoadingDynamic : false}
        />
      )}
    </div>
  );
}
