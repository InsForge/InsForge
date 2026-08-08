import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';

/**
 * What a self-hoster sees when no compute provider is configured.
 *
 * Reached from metadata rather than from a failed list request, so there is no
 * spinner-then-error sequence that reads as a broken page.
 *
 * It states both ways in, Docker first, because that is the one an operator can
 * act on without signing up for anything — and because the previous copy named
 * only Fly, which left self-hosters with no way to discover the socket mount.
 */
export function ComputeNotConfigured() {
  const { t } = useTranslation('chrome');

  return (
    <div className="flex items-center justify-center h-full px-6 py-12">
      <div className="max-w-2xl space-y-6">
        <div className="space-y-2 text-center">
          <Server className="w-8 h-8 text-muted-foreground mx-auto" />
          <h2 className="text-base font-medium text-foreground">
            {t('compute.notConfigured', { defaultValue: 'Compute is not enabled yet' })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('compute.notConfiguredBody', {
              defaultValue:
                'Pick where your containers should run, then restart the InsForge container.',
            })}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--alpha-8)] p-4 space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {t('compute.setupDockerTitle', { defaultValue: 'Your own Docker host' })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('compute.setupDockerBody', {
                defaultValue:
                  'No account needed. Uncomment the Docker socket mount in your compose file and set DOCKER_GID to your host’s docker group id.',
              })}
            </p>
            <code className="block rounded bg-[var(--alpha-8)] px-2 py-1 text-[11px] text-foreground">
              getent group docker | cut -d: -f3
            </code>
          </div>

          <div className="rounded-lg border border-[var(--alpha-8)] p-4 space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {t('compute.setupFlyTitle', { defaultValue: 'Fly.io' })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('compute.setupFlyBody', {
                defaultValue:
                  'Containers run under your own Fly account. Set both values in your .env.',
              })}
            </p>
            <code className="block rounded bg-[var(--alpha-8)] px-2 py-1 text-[11px] text-foreground">
              FLY_API_TOKEN, FLY_ORG
            </code>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <a
            href="https://docs.insforge.dev/core-concepts/compute/overview"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            {t('compute.setupDocsLink', { defaultValue: 'Setup guide for both providers' })}
          </a>
        </p>
      </div>
    </div>
  );
}
