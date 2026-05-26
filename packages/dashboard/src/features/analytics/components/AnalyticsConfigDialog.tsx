import { useState } from 'react';
import { Eye, EyeOff, Settings } from 'lucide-react';
import TerminalIcon from '#assets/icons/terminal.svg?react';
import {
  Button,
  CopyButton,
  Input,
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
import type { PosthogConnection } from '@insforge/shared-schemas';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useToast } from '#lib/hooks/useToast';
import { ANALYTICS_SETUP_PROMPT } from '#features/analytics/lib/constants';
import { DisconnectDialog } from './posthog/DisconnectDialog';

type Section = 'general' | 'setup-prompt';

interface AnalyticsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: PosthogConnection;
  projectId: string;
}

export function AnalyticsConfigDialog({
  open,
  onOpenChange,
  connection,
  projectId,
}: AnalyticsConfigDialogProps) {
  const [section, setSection] = useState<Section>('general');
  const [revealed, setRevealed] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const { onOpenPosthog } = useDashboardHost();
  const { showToast } = useToast();

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRevealed(false);
      setSection('general');
    }
    onOpenChange(nextOpen);
  };

  const maskedKey =
    connection.apiKey.length > 8
      ? `${connection.apiKey.slice(0, 4)}${'•'.repeat(connection.apiKey.length - 8)}${connection.apiKey.slice(-4)}`
      : '•'.repeat(connection.apiKey.length);

  const title = section === 'general' ? 'General' : 'Setup Prompt';

  const directUrl = `${connection.host}/project/${connection.posthogProjectId}`;

  const handleOpenPosthog = () => {
    if (!onOpenPosthog) {
      window.open(directUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const newTab = window.open('about:blank', '_blank');
    if (!newTab) {
      showToast('Could not open PostHog. Please allow popups and try again.', 'error');
      return;
    }
    try {
      newTab.opener = null;
    } catch {
      newTab.close();
      showToast('Could not open PostHog. Please try again.', 'error');
      return;
    }
    onOpenPosthog(projectId)
      .then((result) => {
        if (result.url) {
          newTab.location.href = result.url;
        } else {
          newTab.close();
          showToast('Could not open PostHog. Please try again.', 'error');
        }
      })
      .catch(() => {
        newTab.close();
        showToast('Could not open PostHog. Please try again.', 'error');
      });
  };

  return (
    <>
      <MenuDialog open={open} onOpenChange={handleOpenChange}>
        <MenuDialogContent>
          <MenuDialogSideNav>
            <MenuDialogSideNavHeader>
              <MenuDialogSideNavTitle>Analytics Config</MenuDialogSideNavTitle>
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
                  active={section === 'setup-prompt'}
                  onClick={() => setSection('setup-prompt')}
                >
                  Setup Prompt
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
                <div className="flex flex-col gap-2">
                  {/* Project info row + actions */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <p className="truncate text-base font-normal leading-7 text-foreground">
                        {connection.projectName}
                      </p>
                      <div className="flex items-center gap-2 text-sm leading-5 text-muted-foreground">
                        <span>{connection.region}</span>
                        {connection.organizationName && (
                          <>
                            <span aria-hidden className="size-1 rounded-full bg-muted-foreground" />
                            <span className="truncate">{connection.organizationName}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="secondary" onClick={handleOpenPosthog}>
                        Open in PostHog
                      </Button>
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

                  <FieldRow label="Project API">
                    <div className="relative flex-1">
                      <Input
                        readOnly
                        value={revealed ? connection.apiKey : maskedKey}
                        className="pr-9 font-mono"
                      />
                      <button
                        type="button"
                        aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
                        onClick={() => setRevealed((v) => !v)}
                        className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[var(--alpha-8)] hover:text-foreground"
                      >
                        {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <CopyButton
                      text={connection.apiKey}
                      showText={false}
                      aria-label="Copy API key"
                    />
                  </FieldRow>

                  <div className="h-px w-full bg-[var(--alpha-8)]" />

                  <FieldRow label="Host">
                    <Input readOnly value={connection.host} className="font-mono" />
                    <CopyButton text={connection.host} showText={false} aria-label="Copy host" />
                  </FieldRow>

                  <div className="h-px w-full bg-[var(--alpha-8)]" />

                  <FieldRow label="Project ID">
                    <Input readOnly value={connection.posthogProjectId} className="font-mono" />
                    <CopyButton
                      text={connection.posthogProjectId}
                      showText={false}
                      aria-label="Copy Project ID"
                    />
                  </FieldRow>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-6 text-muted-foreground">
                    Paste this into your coding agent to set up PostHog analytics for your app
                  </p>
                  <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-0 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
                        <span className="text-xs font-medium leading-4 text-muted-foreground">
                          setup prompt
                        </span>
                      </div>
                      <CopyButton
                        text={ANALYTICS_SETUP_PROMPT}
                        showText={false}
                        className="shrink-0"
                      />
                    </div>
                    <p className="font-mono text-sm leading-6 text-foreground">
                      {ANALYTICS_SETUP_PROMPT}
                    </p>
                  </div>
                </div>
              )}
            </MenuDialogBody>
          </MenuDialogMain>
        </MenuDialogContent>
      </MenuDialog>

      <DisconnectDialog
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
      <label className="w-28 shrink-0 pt-2 text-sm text-foreground">{label}</label>
      <div className="ml-auto flex w-[400px] items-center gap-2">{children}</div>
    </div>
  );
}
