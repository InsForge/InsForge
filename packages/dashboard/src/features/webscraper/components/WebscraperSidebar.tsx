import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  FeatureSidebar,
  type FeatureSidebarHeaderButton,
  type FeatureSidebarListItem,
} from '#components';
import type { ApifyConnection } from '#features/webscraper/services/webscraper.service';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { WebScraperSettingsDialog } from './WebScraperSettingsDialog';

interface WebscraperSidebarProps {
  // Null until the Apify account is connected; tabs and settings stay disabled
  // in that state (the sidebar still shows, mirroring Payments).
  connection: ApifyConnection | null;
  // Undefined on self-hosted deployments (PROJECT_ID is empty by design); only
  // the cloud OAuth handoff needs it.
  projectId: string | undefined;
}

export function WebscraperSidebar({ connection, projectId }: WebscraperSidebarProps) {
  const { t } = useTranslation('chrome');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const connected = !!connection;
  // The host's own mode, not "the OAuth callback happens to be missing".
  const isSelfHosted = !useIsCloudHostingMode();

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
      // shows the connect flow in that state. A missing project id only blocks
      // the cloud OAuth handoff — self-hosting has none and needs none, so
      // gating on it there would make this gear permanently unclickable.
      disabled: !isSelfHosted && !projectId,
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
