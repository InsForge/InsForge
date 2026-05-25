import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import {
  Button,
  CopyButton,
  Input,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogFooter,
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
import { DisconnectDialog } from './posthog/DisconnectDialog';

const ANALYTICS_SETUP_PROMPT =
  "I'm using InsForge as my backend platform. I want to add product analytics to this project. Read the current directory and use the InsForge skill to set up PostHog analytics for me.";

interface AnalyticsConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: PosthogConnection;
}

export function AnalyticsConfigDialog({
  open,
  onOpenChange,
  connection,
}: AnalyticsConfigDialogProps) {
  const [revealed, setRevealed] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRevealed(false);
    }
    onOpenChange(nextOpen);
  };

  const maskedKey =
    connection.apiKey.length > 8
      ? `${connection.apiKey.slice(0, 4)}${'•'.repeat(connection.apiKey.length - 8)}${connection.apiKey.slice(-4)}`
      : '•'.repeat(connection.apiKey.length);

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
                <MenuDialogNavItem active>Connection</MenuDialogNavItem>
              </MenuDialogNavList>
            </MenuDialogNav>
          </MenuDialogSideNav>

          <MenuDialogMain>
            <MenuDialogHeader>
              <MenuDialogTitle>Connection</MenuDialogTitle>
              <MenuDialogCloseButton />
            </MenuDialogHeader>

            <MenuDialogBody>
              <div className="flex flex-col gap-4">
                <ReadOnlyField label="Host" value={connection.host} />
                <ReadOnlyField label="Project ID" value={connection.posthogProjectId} />

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Project API Key
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={revealed ? connection.apiKey : maskedKey}
                      className="font-mono"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={revealed ? 'Hide API key' : 'Reveal API key'}
                      onClick={() => setRevealed((v) => !v)}
                    >
                      {revealed ? <EyeOff /> : <Eye />}
                    </Button>
                    <CopyButton
                      text={connection.apiKey}
                      showText={false}
                      aria-label="Copy API key"
                    />
                  </div>
                </div>

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
            </MenuDialogBody>

            <MenuDialogFooter>
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={() => setDisconnecting(true)}
              >
                Disconnect
              </Button>
            </MenuDialogFooter>
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono" />
        <CopyButton text={value} showText={false} aria-label={`Copy ${label}`} />
      </div>
    </div>
  );
}
