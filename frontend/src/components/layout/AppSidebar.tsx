import { useMemo, useState } from 'react';
import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { PrimaryMenu } from './PrimaryMenu';
import { SecondaryMenu } from './SecondaryMenu';
import {
  staticMenuItems,
  documentationMenuItem,
  usageMenuItem,
  type PrimaryMenuItem,
} from '@/lib/utils/menuItems';
import { useLocation, matchPath } from 'react-router-dom';
import { isInsForgeCloudProject, isIframe } from '@/lib/utils/utils';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';
import { ProjectInfoModal } from '@/components/ProjectInfoModal';
import { Settings } from 'lucide-react';

interface AppSidebarProps extends React.HTMLAttributes<HTMLElement> {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function AppSidebar({ isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const { pathname } = useLocation();
  const { menuItems: logsMenuItems, isLoading: logsLoading } = useLogSources();
  const [isProjectInfoModalOpen, setIsProjectInfoModalOpen] = useState(false);

  const isCloud = isInsForgeCloudProject();
  const isInIframe = isIframe();

  // Create a settings menu item that behaves differently based on iframe context
  const settingsMenuItem: PrimaryMenuItem = useMemo(
    () => ({
      id: 'settings',
      label: 'Settings',
      href: '',
      icon: Settings,
      onClick: () => {
        if (isInIframe) {
          // In iframe: use postMessage to show cloud's settings overlay
          postMessageToParent({ type: 'SHOW_SETTINGS_OVERLAY' }, '*');
        } else {
          // Not in iframe: show local project info modal
          setIsProjectInfoModalOpen(true);
        }
      },
    }),
    [isInIframe]
  );

  // Build bottom menu items based on deployment environment
  const bottomMenuItems = useMemo(() => {
    const items = [];

    // Only show Usage when in iframe (postMessage to parent works)
    if (isCloud && isInIframe) {
      items.push(usageMenuItem);
    }

    items.push(documentationMenuItem);

    // Add settings button if this is an InsForge Cloud project
    if (isCloud) {
      items.push(settingsMenuItem);
    }

    return items;
  }, [isCloud, isInIframe, settingsMenuItem]);

  // Find which primary menu item matches the current route
  // Items with secondary menus use prefix matching (end: false)
  // Items without secondary menus use exact matching (end: true)
  const activeMenu = staticMenuItems.find((item) => {
    const hasSecondaryMenu = !!item.secondaryMenu || item.id === 'logs';
    return matchPath({ path: item.href, end: !hasSecondaryMenu }, pathname);
  });

  // Get secondary menu items (special case for logs)
  const secondaryMenuItems = activeMenu?.id === 'logs' ? logsMenuItems : activeMenu?.secondaryMenu;
  const isLoading = activeMenu?.id === 'logs' ? logsLoading : false;

  return (
    <>
      <div className="flex h-full">
        <PrimaryMenu
          items={staticMenuItems}
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

      {/* Project Info Modal for cloud deployments accessed directly (not in iframe) */}
      <ProjectInfoModal
        open={isProjectInfoModalOpen}
        onClose={() => setIsProjectInfoModalOpen(false)}
      />
    </>
  );
}
