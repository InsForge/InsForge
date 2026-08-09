import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Container, Cloud, CheckCircle2, CircleDashed } from 'lucide-react';
import {
  CodeBlock,
  MenuDialog,
  MenuDialogBody,
  MenuDialogCloseButton,
  MenuDialogContent,
  MenuDialogDescription,
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

interface Capabilities {
  regions?: boolean;
  scaleToZero?: boolean;
  ingressModes?: string[];
  sourceBuild?: string;
}

interface ComputeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Providers the backend reports as configured. */
  configured: string[];
  defaultProvider: string | undefined;
  /** Provider to open on, so the CTA lands on the one the operator was looking at. */
  initialProvider?: string;
  /** Capabilities per provider, as reported by /api/metadata. */
  capabilities?: Record<string, Capabilities | undefined>;
}

const COMPOSE_SNIPPET = `services:
  insforge:
    volumes:
      - \${DOCKER_SOCKET_PATH:-/var/run/docker.sock}:\${DOCKER_SOCKET_PATH:-/var/run/docker.sock}
    group_add: ["\${DOCKER_GID:?set DOCKER_GID to your host docker group id}"]`;

/**
 * Guided setup and live status for the two compute providers.
 *
 * Deliberately not a form. Enabling Docker means mounting the host's Docker socket
 * into this container — a compose-level change no API can make from inside the
 * container it would be changing. Fly credentials are read from the environment at
 * boot. So what a dialog can usefully do is tell you exactly which state you are in
 * and hand you the exact lines to paste, which is what this does.
 *
 * Reachable from the compute sidebar's gear and from the quick-start CTA, so an
 * operator who lands on an unconfigured tab has somewhere to go.
 */
export function ComputeSettingsDialog({
  open,
  onOpenChange,
  configured,
  defaultProvider,
  initialProvider,
  capabilities,
}: ComputeSettingsDialogProps) {
  const { t } = useTranslation('chrome');
  const [activeProvider, setActiveProvider] = useState<'docker' | 'fly'>('docker');

  // Follow the caller when it names a provider, so opening from a provider page lands
  // on that provider's steps rather than always on Docker.
  useEffect(() => {
    if (open && (initialProvider === 'docker' || initialProvider === 'fly')) {
      setActiveProvider(initialProvider);
    }
  }, [open, initialProvider]);

  const isReady = (p: string) => configured.includes(p);

  const CapabilityList = ({ provider }: { provider: string }) => {
    const caps = capabilities?.[provider];
    if (!caps) {
      return null;
    }
    const facts: [string, string][] = [
      [
        t('compute.capRegions', { defaultValue: 'Region choice' }),
        caps.regions
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capSingleHost', { defaultValue: 'Single host' }),
      ],
      [
        t('compute.capScaleToZero', { defaultValue: 'Scale to zero' }),
        caps.scaleToZero
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capNo', { defaultValue: 'No' }),
      ],
      [
        t('compute.capIngress', { defaultValue: 'Ingress modes' }),
        (caps.ingressModes ?? []).join(', '),
      ],
      [
        t('compute.capSourceBuild', { defaultValue: 'Source builds' }),
        caps.sourceBuild === 'context-upload'
          ? t('compute.capUploadContext', { defaultValue: 'Upload a build context' })
          : caps.sourceBuild === 'flyctl'
            ? t('compute.capFlyctl', { defaultValue: 'Built by the CLI with flyctl' })
            : t('compute.capNo', { defaultValue: 'No' }),
      ],
    ];
    return (
      <dl className="flex flex-col gap-1.5 rounded-lg border border-[var(--alpha-8)] bg-card p-3">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 text-xs">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    );
  };

  const StatusLine = ({ provider }: { provider: string }) => (
    <div className="flex items-center gap-2 text-sm">
      {isReady(provider) ? (
        <>
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-foreground">
            {t('compute.providerReady', { defaultValue: 'Configured and ready' })}
          </span>
          {provider === defaultProvider && (
            <span className="text-xs text-muted-foreground">
              {t('compute.providerIsDefault', {
                defaultValue: '· new services go here',
              })}
            </span>
          )}
        </>
      ) : (
        <>
          <CircleDashed className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            {t('compute.providerNotConfigured', { defaultValue: 'Not configured' })}
          </span>
        </>
      )}
    </div>
  );

  return (
    <MenuDialog open={open} onOpenChange={onOpenChange}>
      <MenuDialogContent>
        <MenuDialogSideNav>
          <MenuDialogSideNavHeader>
            <MenuDialogSideNavTitle>
              {t('compute.settingsTitle', { defaultValue: 'Compute Settings' })}
            </MenuDialogSideNavTitle>
          </MenuDialogSideNavHeader>
          <MenuDialogNav>
            <MenuDialogNavList>
              <MenuDialogNavItem
                icon={<Container className="h-5 w-5" />}
                active={activeProvider === 'docker'}
                onClick={() => setActiveProvider('docker')}
              >
                {t('compute.providerDocker', { defaultValue: 'Docker' })}
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<Cloud className="h-5 w-5" />}
                active={activeProvider === 'fly'}
                onClick={() => setActiveProvider('fly')}
              >
                {t('compute.providerFly', { defaultValue: 'Fly.io' })}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>
              {activeProvider === 'docker'
                ? t('compute.providerDockerTitle', { defaultValue: 'Your own Docker host' })
                : t('compute.providerFlyTitle', { defaultValue: 'Fly.io' })}
            </MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {t('compute.settingsDescription', {
                defaultValue: 'Compute provider setup and status',
              })}
            </MenuDialogDescription>
            <MenuDialogCloseButton />
          </MenuDialogHeader>

          <MenuDialogBody>
            {activeProvider === 'docker' ? (
              <div className="flex flex-col gap-5">
                <StatusLine provider="docker" />
                <CapabilityList provider="docker" />
                <p className="text-sm text-muted-foreground">
                  {t('compute.dockerIntro', {
                    defaultValue:
                      'Containers run on the same Docker daemon as InsForge, as siblings of this container. No account and no per-container bill.',
                  })}
                </p>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.dockerStep1', {
                      defaultValue: '1. Uncomment these lines in your compose file',
                    })}
                  </h4>
                  <CodeBlock code={COMPOSE_SNIPPET} variant="compact" label="docker-compose.yml" />
                </div>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.dockerStep2', {
                      defaultValue: '2. Put your host’s docker group id in .env',
                    })}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {t('compute.dockerStep2Body', {
                      defaultValue:
                        'The socket is mode 660 root:docker, so the backend needs a matching group. On Docker Desktop the socket is owned by root inside the VM — use 0.',
                    })}
                  </p>
                  <CodeBlock
                    code={
                      'DOCKER_GID=$(getent group docker | cut -d: -f3)   # Linux\nDOCKER_GID=0                                     # Docker Desktop'
                    }
                    variant="compact"
                    label=".env"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.dockerStep3', { defaultValue: '3. Restart InsForge' })}
                  </h4>
                  <CodeBlock code="docker compose up -d insforge" variant="compact" />
                </div>

                <p className="text-xs text-muted-foreground">
                  {t('compute.dockerSocketWarning', {
                    defaultValue:
                      'The Docker socket is root-equivalent on the host, so mounting it is a deliberate choice. InsForge builds every container spec itself and never forwards caller-supplied options, so a leaked API key cannot request a privileged container.',
                  })}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <StatusLine provider="fly" />
                <CapabilityList provider="fly" />
                <p className="text-sm text-muted-foreground">
                  {t('compute.flyIntro', {
                    defaultValue:
                      'Containers run on Fly.io under your own account, with selectable regions and scale-to-zero.',
                  })}
                </p>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.flyStep1', { defaultValue: '1. Create a token and find your org' })}
                  </h4>
                  <CodeBlock code={'fly tokens create org\nfly orgs list'} variant="compact" />
                </div>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.flyStep2', { defaultValue: '2. Set both values in .env' })}
                  </h4>
                  <CodeBlock
                    code={'FLY_API_TOKEN=...\nFLY_ORG=your-org-slug'}
                    variant="compact"
                    label=".env"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('compute.flyBothRequired', {
                      defaultValue:
                        'Both are required — a token with no org has nothing to authenticate against.',
                    })}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-foreground">
                    {t('compute.flyStep3', { defaultValue: '3. Restart InsForge' })}
                  </h4>
                  <CodeBlock code="docker compose up -d insforge" variant="compact" />
                </div>
              </div>
            )}
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}
