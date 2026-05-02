import { useMemo, useState } from 'react';
import {
  dashboardDeploymentsMenuItem,
  dashboardDTestDocMenuItem,
  dashboardDTestInstallMenuItem,
  dashboardSettingsMenuItem,
  dashboardStaticMenuItems,
  type DashboardPrimaryMenuItem,
} from '#navigation/menuItems';
import { Link, useLocation, matchPath } from 'react-router-dom';
import { ExternalLink, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { cn, isInsForgeCloudProject } from '#lib/utils/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@insforge/ui';
import { ProjectSettingsMenuDialog } from '#features/dashboard/components';
import { getFeatureFlag } from '#lib/analytics/posthog';
import { useDashboardHost } from '#lib/config/DashboardHostContext';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AppSidebar({ isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const { pathname } = useLocation();
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);

  const isCloud = isInsForgeCloudProject();
  const host = useDashboardHost();
  const isDTest = getFeatureFlag('dashboard-v4-experiment') === 'd_test';
  const isDTestCloud = isDTest && host.mode === 'cloud-hosting';

  // Insert deployments after Model Gateway for cloud projects. Compute
  // already terminates the section, so deployments doesn't need sectionEnd.
  const mainMenuItems = useMemo(() => {
    const items = dashboardStaticMenuItems.map((item) => ({ ...item }));

    if (isCloud) {
      const aiItemIndex = items.findIndex((item) => item.id === 'ai');
      const deploymentsItem: DashboardPrimaryMenuItem = { ...dashboardDeploymentsMenuItem };

      if (aiItemIndex >= 0) {
        items.splice(aiItemIndex + 1, 0, deploymentsItem);
        return items;
      }

      return [...items, deploymentsItem];
    }

    return items;
  }, [isCloud]);

  // d_test + cloud-hosting prepends Install + Doc above Settings in the
  // bottom nav. Other shells just show Settings.
  const bottomMenuItems = useMemo(() => {
    const items: DashboardPrimaryMenuItem[] = [];
    if (isDTestCloud) {
      items.push({ ...dashboardDTestInstallMenuItem });
      items.push({ ...dashboardDTestDocMenuItem });
    }
    items.push({ ...dashboardSettingsMenuItem, onClick: () => setIsSettingsDialogOpen(true) });
    return items;
  }, [isDTestCloud]);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = useMemo(() => {
    const allItems = [...mainMenuItems, ...bottomMenuItems];
    return allItems.find((item) => {
      if (item.external || item.onClick) {
        return false;
      }

      const shouldMatchExactly = item.href === '/dashboard';
      return !!matchPath({ path: item.href, end: shouldMatchExactly }, pathname);
    });
  }, [mainMenuItems, bottomMenuItems, pathname]);

  const handleToggleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleCollapse();
  };

  const menuItemBaseClasses = (isActive: boolean) =>
    cn(
      'group flex items-center rounded transition-colors',
      isCollapsed ? 'h-8 w-full justify-start p-1.5' : 'h-8 w-full gap-1 p-1.5',
      isActive
        ? 'bg-toast text-foreground'
        : 'text-muted-foreground hover:bg-alpha-4 hover:text-foreground'
    );

  const MenuItemLabel = ({ label, isActive }: { label: string; isActive: boolean }) => (
    <span
      className={cn(
        'min-w-0 truncate px-2 text-sm font-normal leading-5',
        isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
      )}
    >
      {label}
    </span>
  );

  const MenuItemIcon = ({
    item,
    isActive,
  }: {
    item: DashboardPrimaryMenuItem;
    isActive: boolean;
  }) => (
    <item.icon
      className={cn(
        'h-5 w-5 shrink-0',
        isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
      )}
    />
  );

  const MenuItem = ({
    item,
    isBottom = false,
  }: {
    item: DashboardPrimaryMenuItem;
    isBottom?: boolean;
  }) => {
    const isActive = item.id === activeMenu?.id;
    const itemClasses = menuItemBaseClasses(isActive);

    const content = (
      <>
        <MenuItemIcon item={item} isActive={isActive} />
        {!isCollapsed && <MenuItemLabel label={item.label} isActive={isActive} />}
        {!isCollapsed && isBottom && item.external && (
          <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
        )}
      </>
    );

    if (item.onClick || item.external) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={itemClasses}
              onClick={
                item.onClick || (item.external ? () => window.open(item.href, '_blank') : undefined)
              }
            >
              {content}
            </button>
          </TooltipTrigger>
          {isCollapsed && (
            <TooltipContent side="right">
              <div className="flex items-center gap-2">
                <p>{item.label}</p>
                {item.external && <ExternalLink className="h-3 w-3" />}
              </div>
            </TooltipContent>
          )}
        </Tooltip>
      );
    }

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to={item.href} className={itemClasses}>
            {content}
          </Link>
        </TooltipTrigger>
        {isCollapsed && (
          <TooltipContent side="right">
            <p>{item.label}</p>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  const ToggleButton = ({ compact = false }: { compact?: boolean }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleToggleClick}
          className={cn(
            'flex items-center justify-center rounded text-muted-foreground transition-colors hover:bg-alpha-8 hover:text-foreground',
            compact ? 'h-6 w-6' : 'h-9 w-9 p-1.5'
          )}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelRightOpen className="h-5 w-5" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{isCollapsed ? 'Expand' : 'Collapse'}</p>
      </TooltipContent>
    </Tooltip>
  );

  const bottomItemsList = bottomMenuItems ?? [];
  // When expanded, the toggle button sits inline with the last bottom item
  // (Settings) so the layout matches Figma regardless of how many items are
  // above it. When collapsed, the toggle gets its own centered row.
  const inlineToggleHost =
    !isCollapsed && bottomItemsList.length > 0 ? bottomItemsList.length - 1 : -1;

  return (
    <>
      <TooltipProvider disableHoverableContent delayDuration={300}>
        <aside
          className={cn(
            'bg-semantic-2 border-r border-[var(--alpha-8)] h-full flex flex-col flex-shrink-0 px-2 pt-3 pb-2',
            'transition-[width] duration-300 ease-in-out overflow-hidden',
            isCollapsed ? 'w-[52px]' : 'w-[200px]'
          )}
        >
          <nav className="flex min-h-0 w-full flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
            {mainMenuItems.map((item) => (
              <div key={item.id}>
                <MenuItem item={item} />
                {item.sectionEnd && <div className="my-1.5 h-px w-full bg-alpha-8" />}
              </div>
            ))}
          </nav>

          <div className="flex-1" />

          <div className={cn('w-full', isCollapsed ? 'space-y-2' : 'space-y-1.5')}>
            {bottomItemsList.map((item, index) =>
              index === inlineToggleHost ? (
                <div key={item.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <MenuItem item={item} isBottom />
                  </div>
                  <ToggleButton compact />
                </div>
              ) : (
                <MenuItem key={item.id} item={item} isBottom />
              )
            )}
            {isCollapsed && (
              <div className="flex justify-center">
                <ToggleButton />
              </div>
            )}
          </div>
        </aside>
      </TooltipProvider>
      <ProjectSettingsMenuDialog
        open={isSettingsDialogOpen}
        onOpenChange={setIsSettingsDialogOpen}
      />
    </>
  );
}
