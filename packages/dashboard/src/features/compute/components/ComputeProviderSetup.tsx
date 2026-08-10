import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import { Button, CopyButton } from '@insforge/ui';
import { computeProviderLabel } from '#features/compute/constants';

interface ComputeProviderSetupProps {
  provider: string;
  socketPath?: string;
  /** Opens the compute settings dialog on this provider. */
  onConfigure: () => void;
}

const COMPOSE_SNIPPET = `services:
  insforge:
    volumes:
      - \${DOCKER_SOCKET_PATH:-/var/run/docker.sock}:\${DOCKER_SOCKET_PATH:-/var/run/docker.sock}
    group_add: ["\${DOCKER_GID:?set DOCKER_GID to your host docker group id}"]`;

const RESTART_COMMAND = 'docker compose up -d insforge';

/**
 * Setup flow for a provider that is not enabled yet, shown in the content pane
 * while the sidebar stays put — the shape WebscraperLayout uses for an
 * unconnected Apify account.
 *
 * Per provider rather than one generic screen: enabling Docker means editing compose
 * and restarting, enabling Fly means two credentials, and a single screen covering
 * both would bury whichever one the operator actually wants.
 *
 * Values are entered in the settings dialog, not here — the same split
 * PaymentsOnboardingState uses. The guide is a guide; one place owns the inputs, so
 * there is no second form to keep in step with it.
 */
export function ComputeProviderSetup({
  provider,
  socketPath,
  onConfigure,
}: ComputeProviderSetupProps) {
  const { t } = useTranslation('chrome');
  const label = computeProviderLabel(provider);

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-auto p-6">
      {/* Centred with `my-auto` rather than `items-center` on the scroll container:
          auto margins collapse to 0 once the content is taller than the box, while
          `items-center` keeps centring and pushes the top out of reach. */}
      <div className="my-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">
            {t('compute.providerNotEnabled', {
              defaultValue: '{{provider}} is not enabled yet',
              provider: label,
            })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {provider === 'docker'
              ? t('compute.setupDockerSummary', {
                  defaultValue:
                    'Run containers on the same Docker daemon as InsForge — no account and no per-container bill.',
                })
              : t('compute.setupFlySummary', {
                  defaultValue:
                    'Run containers on Fly.io under your own account, with selectable regions and scale-to-zero.',
                })}
          </p>
        </div>

        <div className="flex flex-col self-stretch rounded border border-[var(--alpha-8)] bg-card p-6">
          {provider === 'docker' ? (
            <>
              <StepItem number={1}>
                <StepText
                  title={t('compute.dockerStep1', {
                    defaultValue: 'Uncomment these lines in your compose file',
                  })}
                  body={t('compute.dockerStep1Body', {
                    defaultValue:
                      'These two lines are already in your compose file, commented out. The socket is root-equivalent on the host, so uncommenting it is a deliberate choice.',
                  })}
                />
                <Snippet label="docker-compose.yml" code={COMPOSE_SNIPPET} />
              </StepItem>

              <StepItem number={2}>
                <StepText
                  title={t('compute.dockerStep2', {
                    defaultValue: 'Put your host’s docker group id in .env',
                  })}
                  body={t('compute.dockerStep2Body', {
                    defaultValue:
                      'The socket is mode 660 root:docker, so the backend needs a matching group. On Docker Desktop it is owned by root inside the VM, so the value is 0.',
                  })}
                />
                <Snippet
                  label=".env"
                  code={
                    'DOCKER_GID=$(getent group docker | cut -d: -f3)   # Linux\nDOCKER_GID=0                                     # Docker Desktop'
                  }
                />
              </StepItem>

              <StepItem number={3} last>
                <StepText
                  title={t('compute.dockerStep3', { defaultValue: 'Restart InsForge' })}
                  body={t('compute.dockerStep3Body', {
                    defaultValue: 'The driver registers itself once the socket is reachable.',
                  })}
                />
                {/* The path is data, not prose: the single most useful diagnostic when
                    a mount is missing, so it reads as a value rather than a sentence. */}
                {socketPath && (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t('compute.dockerSocketLookingAt', { defaultValue: 'Looking for' })}{' '}
                    <span className="font-mono text-foreground">{socketPath}</span>
                  </p>
                )}
                <Snippet code={RESTART_COMMAND} />
              </StepItem>
            </>
          ) : (
            <>
              <StepItem number={1}>
                <StepText
                  title={t('compute.flyStep1', {
                    defaultValue: 'Find your org, then create a token',
                  })}
                  body={t('compute.flyStep1Body', {
                    defaultValue: 'Both come from the Fly CLI, signed in to your own account.',
                  })}
                />
                {/* Org first: `tokens create org` takes the slug with -o, and without
                    it flyctl stops to ask for an org you have not looked up yet. */}
                <Snippet code={'fly orgs list\nfly tokens create org -o <your-org>'} />
              </StepItem>

              {/* No third step: these are values, so saving them in the dialog takes
                  effect immediately and nothing needs restarting. */}
              <StepItem number={2} last>
                <StepText
                  title={t('compute.flyStep2', {
                    defaultValue: 'Paste them into compute settings',
                  })}
                  body={t('compute.flyBothRequired', {
                    defaultValue:
                      'Both are required — a token with no org has nothing to authenticate against. Saving takes effect immediately; no restart needed.',
                  })}
                />
              </StepItem>
            </>
          )}

          <div className="pl-10">
            <Button
              variant="outline"
              size="default"
              onClick={onConfigure}
              className="h-8 rounded px-2.5"
            >
              <Settings className="h-4 w-4" />
              {provider === 'docker'
                ? t('compute.openDockerSettings', { defaultValue: 'Open Docker settings' })
                : t('compute.enterFlyCredentials', {
                    defaultValue: 'Enter Fly.io credentials',
                  })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepText({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium leading-6 text-foreground">{title}</p>
      <p className="text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

function Snippet({ code, label }: { code: string; label?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-semantic-1 p-3">
      <div className="flex items-center justify-between">
        {label ? (
          <div className="flex h-5 items-center rounded bg-[var(--alpha-8)] px-2">
            <span className="text-xs font-medium leading-4 text-muted-foreground">{label}</span>
          </div>
        ) : (
          <span />
        )}
        <CopyButton text={code} showText={false} className="shrink-0" />
      </div>
      {/* `break-all` because the compose volume line is one unbroken token — with
          wrapping only at whitespace it ran past the card's edge. Same markup the
          overview's command blocks use. */}
      <pre className="m-0 whitespace-pre-wrap break-all font-mono text-sm leading-6 text-foreground">
        {code}
      </pre>
    </div>
  );
}

/** Numbered step with the connector rail, matching ApifyConnectPanel. */
function StepItem({
  number,
  children,
  last,
}: {
  number: number;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div className="flex w-full items-start gap-3">
      <div className="flex flex-col items-center self-stretch">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--alpha-16)] bg-toast text-sm leading-5 text-foreground">
          {number}
        </div>
        {!last && <div className="w-px flex-1 bg-[var(--alpha-16)]" />}
      </div>
      <div className={`flex min-w-0 flex-1 flex-col gap-3 pl-1 ${last ? '' : 'pb-6'}`}>
        {children}
      </div>
    </div>
  );
}
