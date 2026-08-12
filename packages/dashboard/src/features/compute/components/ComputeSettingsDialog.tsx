import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Container, Cloud, CheckCircle2 } from 'lucide-react';
import {
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
import { computeProviderLabel } from '#features/compute/constants';
import { FlyCredentialsForm } from './FlyCredentialsForm';

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
  /** Provider to open on, so the gear lands on the one being looked at. */
  initialProvider?: string;
  /** Capabilities per provider, as reported by /api/metadata. */
  capabilities?: Record<string, Capabilities | undefined>;
}

type ProviderTab = 'docker' | 'fly';

/**
 * What each compute provider is configured to do, and — for Fly — its credentials.
 *
 * Fly is editable here because its credentials are just values: they go to the secret
 * store, the backend refreshes its snapshot and rebuilds the provider registry, and
 * Fly becomes usable without a restart. Docker is not, because enabling it means
 * mounting a socket into this container, which no API can do from inside the container
 * it would be changing; its steps live on the provider page.
 *
 * The capability list is read-only for both — it reports what the backend says a
 * provider can do, which is not something to set from here.
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
  const [activeProvider, setActiveProvider] = useState<ProviderTab>('docker');

  // Follow the caller when it names a provider, so opening from a provider's page
  // lands on that provider rather than always on Docker.
  useEffect(() => {
    if (open && (initialProvider === 'docker' || initialProvider === 'fly')) {
      setActiveProvider(initialProvider);
    }
  }, [open, initialProvider]);

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
                {computeProviderLabel('docker')}
              </MenuDialogNavItem>
              <MenuDialogNavItem
                icon={<Cloud className="h-5 w-5" />}
                active={activeProvider === 'fly'}
                onClick={() => setActiveProvider('fly')}
              >
                {computeProviderLabel('fly')}
              </MenuDialogNavItem>
            </MenuDialogNavList>
          </MenuDialogNav>
        </MenuDialogSideNav>

        <MenuDialogMain>
          <MenuDialogHeader>
            <MenuDialogTitle>{computeProviderLabel(activeProvider)}</MenuDialogTitle>
            <MenuDialogDescription className="sr-only">
              {t('compute.settingsDescription', {
                defaultValue: 'Compute provider status and capabilities',
              })}
            </MenuDialogDescription>
            <MenuDialogCloseButton className="ml-auto" />
          </MenuDialogHeader>

          <MenuDialogBody>
            <div className="flex flex-col gap-4">
              <ProviderStatus
                configured={configured.includes(activeProvider)}
                isDefault={activeProvider === defaultProvider}
              />
              <ProviderCapabilities caps={capabilities?.[activeProvider]} />
              {/* Fly credentials are values, so they can be entered here and take
                  effect without a restart. Docker has nothing to enter: it is enabled
                  by mounting a socket, and everything else about it is read from the
                  same compose file and `.env` — one source of truth, not two. Its
                  steps live on the provider page. */}
              {activeProvider === 'fly' && <FlyCredentialsForm />}
            </div>
          </MenuDialogBody>
        </MenuDialogMain>
      </MenuDialogContent>
    </MenuDialog>
  );
}

/**
 * Shown only once a provider is configured.
 *
 * There is no not-configured counterpart: the Fly panel's own per-field badges
 * already say which credential is missing, and Docker's panel is reached from a page
 * that is entirely about how to enable it. A second "not configured" line said
 * nothing the surrounding UI had not already said.
 */
function ProviderStatus({ configured, isDefault }: { configured: boolean; isDefault: boolean }) {
  const { t } = useTranslation('chrome');

  if (!configured) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
      <span className="text-foreground">
        {t('compute.providerReady', { defaultValue: 'Configured and ready' })}
      </span>
      {isDefault && (
        <span className="text-xs text-muted-foreground">
          {t('compute.providerIsDefault', { defaultValue: '· new services go here' })}
        </span>
      )}
    </div>
  );
}

function ProviderCapabilities({ caps }: { caps: Capabilities | undefined }) {
  const { t } = useTranslation('chrome');
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
      (caps.ingressModes ?? [])
        .map((mode) => t(`compute.ingressModes.${mode}`, { defaultValue: mode }))
        .join(', '),
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
    <dl className="flex flex-col gap-2 rounded border border-[var(--alpha-8)] bg-card p-3">
      {facts.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 text-sm leading-6">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
