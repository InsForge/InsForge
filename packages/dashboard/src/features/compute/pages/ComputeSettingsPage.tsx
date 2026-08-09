import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Button } from '@insforge/ui';
import { useMetadata } from '#lib/hooks/useMetadata';
import type { ComputeOutletContext } from '#features/compute/components/ComputeLayout';

/**
 * What compute is actually able to do on this deployment.
 *
 * Read-only on purpose: every one of these comes from an environment variable and
 * needs a container restart, so a form that appeared to change them would be lying.
 * The page exists to answer the questions an operator has when something looks
 * wrong — is my socket working, which provider do new services go to, why is the
 * region picker missing, why can't I build from source. The setup steps themselves
 * are in the dialog the button opens.
 */
export default function ComputeSettingsPage() {
  const { t } = useTranslation('chrome');
  const { configured, defaultProvider, openSettings } = useOutletContext<ComputeOutletContext>();
  const { metadata } = useMetadata();
  const providers = metadata?.compute?.providers ?? {};
  const capsFor = (name: string) => providers[name as keyof typeof providers];

  const rows: { key: string; label: string; value: (provider: string) => string }[] = [
    {
      key: 'regions',
      label: t('compute.capRegions', { defaultValue: 'Region choice' }),
      value: (p) =>
        capsFor(p)?.regions
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capSingleHost', { defaultValue: 'Single host' }),
    },
    {
      key: 'scaleToZero',
      label: t('compute.capScaleToZero', { defaultValue: 'Scale to zero' }),
      value: (p) =>
        capsFor(p)?.scaleToZero
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capNo', { defaultValue: 'No' }),
    },
    {
      key: 'ingressModes',
      label: t('compute.capIngress', { defaultValue: 'Ingress modes' }),
      value: (p) => (capsFor(p)?.ingressModes ?? []).join(', '),
    },
    {
      key: 'sourceBuild',
      label: t('compute.capSourceBuild', { defaultValue: 'Source builds' }),
      value: (p) => {
        const mode = capsFor(p)?.sourceBuild;
        if (mode === 'context-upload') {
          return t('compute.capUploadContext', { defaultValue: 'Upload a build context' });
        }
        if (mode === 'flyctl') {
          return t('compute.capFlyctl', { defaultValue: 'Built by the CLI with flyctl' });
        }
        return t('compute.capNo', { defaultValue: 'No' });
      },
    },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[rgb(var(--semantic-1))]">
      <div className="flex-1 overflow-auto pt-6 px-6 pb-6">
        <div className="w-full max-w-[1080px] mx-auto flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-medium text-foreground leading-8">
                {t('compute.settingsTitle', { defaultValue: 'Compute Settings' })}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('compute.settingsSubtitle', {
                  defaultValue:
                    'Set by environment variables on the InsForge container. Changing them needs a restart.',
                })}
              </p>
            </div>
            {/* Same dialog the sidebar gear and the quick-start CTA open, so the
                setup steps are one click from wherever the operator is. */}
            <Button variant="secondary" size="sm" onClick={openSettings} className="shrink-0">
              <Settings className="mr-2 h-4 w-4" />
              {t('compute.setupProviders', { defaultValue: 'Setup guide' })}
            </Button>
          </div>

          <div className="bg-card border border-[var(--alpha-8)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--alpha-8)]">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    {t('compute.capability', { defaultValue: 'Capability' })}
                  </th>
                  {configured.map((provider) => (
                    <th
                      key={provider}
                      className="px-4 py-2.5 text-left font-medium text-foreground"
                    >
                      <span className="flex items-center gap-2">
                        {provider}
                        {provider === defaultProvider && (
                          <span className="text-xs font-normal text-muted-foreground">
                            {t('compute.defaultProviderTag', { defaultValue: 'default' })}
                          </span>
                        )}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-[var(--alpha-8)] last:border-b-0">
                    <td className="px-4 py-2.5 text-muted-foreground">{row.label}</td>
                    {configured.map((provider) => (
                      <td key={provider} className="px-4 py-2.5 text-foreground">
                        {row.value(provider)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('compute.settingsDocsPrefix', {
              defaultValue: 'Provider setup and the full list of',
            })}{' '}
            <a
              href="https://docs.insforge.dev/core-concepts/compute/overview"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              {t('compute.settingsDocsLink', { defaultValue: 'compute environment variables' })}
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
