import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('chrome');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = !!connection;

  const items: FeatureSidebarListItem[] = [
    {
      id: 'actors',
      label: t('webscraper.actors', { defaultValue: 'Actors' }),
      href: '/dashboard/webscraper/actors',
      disabled: !connected,
    },
    {
      id: 'runs',
      label: t('webscraper.runs', { defaultValue: 'Runs' }),
      href: '/dashboard/webscraper/runs',
      disabled: !connected,
    },
    {
      id: 'dataset',
      label: t('webscraper.dataset', { defaultValue: 'Dataset' }),
      href: '/dashboard/webscraper/dataset',
      disabled: !connected,
    },
  ];

  const headerButtons: FeatureSidebarHeaderButton[] = [
    {
      id: 'webscraper-settings',
      label: t('webscraper.configTitle', { defaultValue: 'Web Scraper Config' }),
      icon: Settings,
      onClick: () => setSettingsOpen(true),
      // Clickable even when not connected (mirrors Analytics); the dialog itself
      // shows the connect flow in that state.
      disabled: !projectId,
    },
  ];

  return (
    <>
      <FeatureSidebar
        title={t('webscraper.title', { defaultValue: 'Web Scraper' })}
        items={items}
        headerButtons={headerButtons}
      />
      <WebScraperSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        connection={connection}
        projectId={projectId}
      />
    </>
  );
}
