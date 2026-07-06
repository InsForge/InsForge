import { useState } from 'react';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import type { ApifyConnection } from '#features/webscraper/services/webscraper.service';
import { WebScraperSettingsDialog } from './WebScraperSettingsDialog';

interface WebscraperSidebarProps {
  // Null until the Apify account is connected; tabs and settings stay disabled
  // in that state (the sidebar still shows, mirroring Payments).
  connection: ApifyConnection | null;
  projectId: string;
}

export function WebscraperSidebar({ connection, projectId }: WebscraperSidebarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = !!connection;

  const items: FeatureSidebarListItem[] = [
    {
      id: 'actors',
      label: 'Actors',
      href: '/dashboard/webscraper/actors',
      disabled: !connected,
    },
    {
      id: 'runs',
      label: 'Runs',
      href: '/dashboard/webscraper/runs',
      disabled: !connected,
    },
    {
      id: 'dataset',
      label: 'Dataset',
      href: '/dashboard/webscraper/dataset',
      disabled: !connected,
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'webscraper-settings',
      label: 'Web Scraper Config',
      icon: Settings,
      onClick: () => setSettingsOpen(true),
      // Clickable even when not connected (mirrors Analytics); the dialog itself
      // shows the connect flow in that state.
      disabled: !projectId,
    },
  ];

  return (
    <>
      <FeatureSidebar title="Web Scraper" items={items} headerButtons={headerButtons} />
      <WebScraperSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        connection={connection}
        projectId={projectId}
      />
    </>
  );
}
