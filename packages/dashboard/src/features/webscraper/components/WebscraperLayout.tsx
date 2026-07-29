import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, useToast } from '@insforge/ui';
import { ErrorState, LoadingState } from '#components';
import { useDashboardHost } from '#lib/config/DashboardHostContext';
import { useProjectId } from '#lib/hooks/useMetadata';
import { webscraperQueryKeys, useApifyConnection } from '#features/webscraper/hooks/useWebscraper';
import type { ApifyConnection } from '#features/webscraper/services/webscraper.service';
import { ApifyConnectPanel } from './ApifyConnectPanel';
import { WebscraperSidebar } from './WebscraperSidebar';

export interface WebscraperOutletContext {
  connection: ApifyConnection;
  projectId: string;
}

export function useWebscraperContext() {
  return useOutletContext<WebscraperOutletContext>();
}

export default function WebscraperLayout() {
  const { t } = useTranslation('chrome');
  const conn = useApifyConnection();
  const { projectId, isLoading: projectIdLoading } = useProjectId();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const { subscribeApifyConnectionStatus, onConnectApify } = useDashboardHost();

  // OAuth completes in the parent cloud shell, which posts the result back here.
  useEffect(() => {
    if (!subscribeApifyConnectionStatus) {
      return;
    }
    return subscribeApifyConnectionStatus((e) => {
      if (e.status === 'connected') {
        void qc.invalidateQueries({ queryKey: webscraperQueryKeys.all });
        showToast(t('webscraper.apifyConnected', { defaultValue: 'Apify connected.' }), 'info');
        return;
      }
      if (e.status === 'error') {
        showToast(
          e.reason
            ? t('webscraper.apifyConnectionFailedReason', {
                defaultValue: 'Apify connection failed: {{reason}}',
                reason: e.reason,
              })
            : t('webscraper.apifyConnectionFailed', {
                defaultValue: 'Apify connection failed. Please try again.',
              }),
          'error'
        );
        return;
      }
      if (e.status === 'cancelled') {
        showToast(
          t('webscraper.apifyConnectionCancelled', {
            defaultValue: 'Apify connection cancelled.',
          }),
          'info'
        );
      }
    });
  }, [qc, showToast, subscribeApifyConnectionStatus, t]);

  if (conn.isLoading || projectIdLoading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <LoadingState
          className="py-0"
          message={t('webscraper.loadingWebScraper', { defaultValue: 'Loading Web Scraper…' })}
        />
      </div>
    );
  }
  if (conn.isError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title={t('webscraper.loadConnectionFailed', {
              defaultValue: 'Failed to load Apify connection',
            })}
            error={t('webscraper.refreshOrContactSupport', {
              defaultValue: 'Please refresh, or contact support if the problem persists.',
            })}
          />
        </div>
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorState
            title={t('webscraper.projectIdUnavailable', {
              defaultValue: 'Project ID unavailable',
            })}
            error={t('webscraper.refreshOrContactSupport', {
              defaultValue: 'Please refresh, or contact support if the problem persists.',
            })}
          />
        </div>
      </div>
    );
  }

  const connection = conn.data ?? null;
  const unhealthy = !!connection && connection.status !== 'active';

  // Sidebar always shows (mirroring Payments). When not connected the tabs and
  // settings gear are disabled and the content pane shows the connect flow;
  // once connected the nested routes render via <Outlet>.
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <WebscraperSidebar connection={connection} projectId={projectId} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!connection ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
            <div className="flex w-full max-w-[760px] flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold text-foreground">
                  {t('webscraper.title', { defaultValue: 'Web Scraper' })}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t('webscraper.connectDescription', {
                    defaultValue:
                      'Connect a web scraper so your coding agent can pull external data on demand.',
                  })}
                </p>
              </div>
              <ApifyConnectPanel projectId={projectId} />
            </div>
          </div>
        ) : (
          <>
            {unhealthy && (
              <div className="flex items-center justify-between gap-3 border-b border-warning bg-warning/10 px-6 py-3">
                <p className="text-sm text-warning">
                  {t('webscraper.connectionUnhealthy', {
                    defaultValue:
                      'Apify connection is {{status}}. Token refresh may have failed, reconnect to restore access.',
                    status: connection.status,
                  })}
                </p>
                <Button
                  variant="secondary"
                  disabled={!onConnectApify}
                  onClick={() => onConnectApify?.(projectId)}
                  className="shrink-0"
                >
                  {t('webscraper.reconnect', { defaultValue: 'Reconnect' })}
                </Button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-hidden">
              <Outlet context={{ connection, projectId } satisfies WebscraperOutletContext} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
