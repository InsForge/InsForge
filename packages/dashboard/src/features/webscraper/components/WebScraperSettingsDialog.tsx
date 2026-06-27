import { useState } from 'react';
import { Settings } from 'lucide-react';
import TerminalIcon from '#assets/icons/terminal.svg?react';
import {
  Button,
  CodeBlock,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogHeader,
  MenuDialogMain,
  MenuDialogNav,
  MenuDialogNavItem,
  MenuDialogNavList,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogTitle,
} from '@insforge/ui';
import type { ApifyConnection } from '#features/webscraper/services/webscraper.service';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { APIFY_CONSOLE_URL, SCRAPE_PROMPT } from './shared';
import { WebScraperDisconnectDialog } from './WebScraperDisconnectDialog';

type Section = 'general' | 'scrape-prompt';

interface WebScraperSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: ApifyConnection | null;
  projectId: string;
}

export function WebScraperSettingsDialog({
  open,
  onOpenChange,
  connection,
  projectId,
}: WebScraperSettingsDialogProps) {
  const [section, setSection] = useState<Section>('general');
  const [disconnecting, setDisconnecting] = useState(false);
  const { onConnectApify } = useDashboardHost();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSection('general');
    }
    onOpenChange(nextOpen);
  };

  const title = section === 'general' ? 'General' : 'Scrape Prompt';
  const planLabel = connection?.planTier ?? connection?.plan ?? 'Unknown plan';

  return (
    <>
      <MenuDialog open={open} onOpenChange={handleOpenChange}>
        <MenuDialogContent>
          <MenuDialogSideNav>
            <MenuDialogSideNavHeader>
              <MenuDialogSideNavTitle>Web Scraper Config</MenuDialogSideNavTitle>
            </MenuDialogSideNavHeader>
            <MenuDialogNav>
              <MenuDialogNavList>
                <MenuDialogNavItem
                  icon={<Settings className="h-5 w-5" />}
                  active={section === 'general'}
                  onClick={() => setSection('general')}
                >
                  General
                </MenuDialogNavItem>
                <MenuDialogNavItem
                  icon={<TerminalIcon className="h-5 w-5" />}
                  active={section === 'scrape-prompt'}
                  onClick={() => setSection('scrape-prompt')}
                >
                  Scrape Prompt
                </MenuDialogNavItem>
              </MenuDialogNavList>
            </MenuDialogNav>
          </MenuDialogSideNav>

          <MenuDialogMain>
            <MenuDialogHeader>
              <MenuDialogTitle>{title}</MenuDialogTitle>
              <MenuDialogCloseButton className="ml-auto" />
            </MenuDialogHeader>

            <MenuDialogBody>
              {section === 'general' ? (
                connection ? (
                  <div className="flex flex-col gap-2">
                    {/* Account info row + actions */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-col">
                        <p className="truncate text-base font-normal leading-7 text-foreground">
                          {connection.apifyUsername ?? 'Apify account'}
                        </p>
                        <div className="flex items-center gap-2 text-sm leading-5 text-muted-foreground">
                          <span>{connection.status}</span>
                          {connection.email && (
                            <>
                              <span
                                aria-hidden
                                className="size-1 rounded-full bg-muted-foreground"
                              />
                              <span className="truncate">{connection.email}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <a href={APIFY_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
                          <Button variant="secondary">View in Apify console</Button>
                        </a>
                        <Button
                          variant="secondary"
                          className="border-warning bg-warning/10 text-warning hover:bg-warning/20"
                          onClick={() => setDisconnecting(true)}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </div>

                    <div className="h-px w-full bg-[var(--alpha-8)]" />

                    <FieldRow label="Account">
                      <p className="text-sm leading-6 text-foreground">
                        {connection.apifyUsername ?? '—'}
                      </p>
                    </FieldRow>

                    <div className="h-px w-full bg-[var(--alpha-8)]" />

                    <FieldRow label="Email">
                      <p className="text-sm leading-6 text-foreground">{connection.email ?? '—'}</p>
                    </FieldRow>

                    <div className="h-px w-full bg-[var(--alpha-8)]" />

                    <FieldRow label="Plan">
                      <p className="text-sm leading-6 text-foreground">{planLabel}</p>
                    </FieldRow>

                    <div className="h-px w-full bg-[var(--alpha-8)]" />

                    <FieldRow label="Status">
                      <p className="text-sm leading-6 text-foreground">{connection.status}</p>
                    </FieldRow>

                    {connection.dataRetentionDays !== null && (
                      <>
                        <div className="h-px w-full bg-[var(--alpha-8)]" />
                        <FieldRow label="Data retention">
                          <p className="text-sm leading-6 text-foreground">
                            Apify keeps datasets {connection.dataRetentionDays} days
                          </p>
                        </FieldRow>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
                    <p className="text-sm leading-6 text-foreground">
                      You haven&apos;t connected Apify yet.
                    </p>
                    <Button
                      variant="primary"
                      disabled={!onConnectApify}
                      onClick={() => onConnectApify?.(projectId)}
                    >
                      Connect Apify
                    </Button>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Paste this into your coding agent to start a scrape with the Apify web scraper
                    skill. Replace the placeholder with what you want to scrape.
                  </p>
                  <CodeBlock code={SCRAPE_PROMPT} label="scrape prompt" />
                </div>
              )}
            </MenuDialogBody>
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>

      <WebScraperDisconnectDialog
        open={disconnecting}
        onClose={() => {
          setDisconnecting(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-6 self-stretch">
      <label className="w-28 shrink-0 pt-1 text-sm text-foreground">{label}</label>
      <div className="ml-auto flex w-[400px] items-center gap-2">{children}</div>
    </div>
  );
}
