import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router-dom';
import { useMetadata } from '#lib/hooks/useMetadata';
import type { ComputeOutletContext } from '#features/compute/components/ComputeLayout';

/**
 * Read-only view of what compute is actually able to do here.
 *
 * Read-only on purpose: every one of these comes from an environment variable and
 * needs a container restart, so a form that appeared to change them would be
 * lying. What the page is for is answering the questions an operator has when
 * something looks wrong — is my Docker socket working, which provider do new
 * services go to, why is the region picker missing, why can't I build from source.
 */
export default function ComputeSettingsPage() {
  const { t } = useTranslation('chrome');
  const { configured, defaultProvider } = useOutletContext<ComputeOutletContext>();
  const { metadata } = useMetadata();
  const providers = metadata?.compute?.providers ?? {};

  const rows: { key: string; label: string; value: (p: string) => string }[] = [
    {
      key: 'regions',
      label: t('compute.capRegions', { defaultValue: 'Region choice' }),
      value: (p) =>
        providers[p as keyof typeof providers]?.regions
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capSingleHost', { defaultValue: 'Single host' }),
    },
    {
      key: 'scaleToZero',
      label: t('compute.capScaleToZero', { defaultValue: 'Scale to zero' }),
      value: (p) =>
        providers[p as keyof typeof providers]?.scaleToZero
          ? t('compute.capYes', { defaultValue: 'Yes' })
          : t('compute.capNo', { defaultValue: 'No' }),
    },
    {
      key: 'ingressModes',
      label: t('compute.capIngress', { defaultValue: 'Ingress modes' }),
      value: (p) => (providers[p as keyof typeof providers]?.ingressModes ?? []).join(', '),
    },
    {
      key: 'sourceBuild',
      label: t('compute.capSourceBuild', { defaultValue: 'Source builds' }),
      value: (p) => {
        const mode = providers[p as keyof typeof providers]?.sourceBuild;
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
    <div className="h-full overflow-auto px-6 py-6">
      <div className="max-w-3xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-base font-medium text-foreground">
            {t('compute.settingsTitle', { defaultValue: 'Compute settings' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('compute.settingsSubtitle', {
              defaultValue:
                'Set by environment variables on the InsForge container. Changing them needs a restart.',
            })}
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--alpha-8)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--alpha-8)] bg-[var(--alpha-4)]">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                  {t('compute.capability', { defaultValue: 'Capability' })}
                </th>
                {configured.map((p) => (
                  <th key={p} className="px-4 py-2 text-left font-medium text-foreground">
                    {p}
                    {p === defaultProvider && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t('compute.defaultProviderTag', { defaultValue: 'default' })}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-[var(--alpha-8)] last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">{row.label}</td>
                  {configured.map((p) => (
                    <td key={p} className="px-4 py-2 text-foreground">
                      {row.value(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('compute.settingsDocsPrefix', { defaultValue: 'Provider setup and the full list of' })}{' '}
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
  );
}
