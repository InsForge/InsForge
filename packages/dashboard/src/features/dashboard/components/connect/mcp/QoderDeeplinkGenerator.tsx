import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createMCPServerConfig, type PlatformType } from './helpers';
import QoderLogo from '#assets/logos/qoder.svg?react';
import { getBackendUrl } from '#lib/utils/utils';
import { trackEvent, getFeatureFlag } from '#lib/analytics/posthog';
import { ANALYTICS_EVENTS, FEATURE_FLAGS } from '#lib/analytics/constants';

interface QoderDeeplinkGeneratorProps {
  apiKey?: string;
  os?: PlatformType;
}

export function QoderDeeplinkGenerator({
  apiKey,
  os = 'macos-linux',
}: QoderDeeplinkGeneratorProps) {
  const { t } = useTranslation('chrome');
  const deeplink = useMemo(() => {
    const config = createMCPServerConfig(apiKey || '', os, getBackendUrl());
    const configString = JSON.stringify(config);
    // Qoder requires: JSON.stringify -> encodeURIComponent -> btoa -> encodeURIComponent
    const base64Config = btoa(encodeURIComponent(configString));
    return `qoder://aicoding.aicoding-deeplink/mcp/add?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }, [apiKey, os]);

  const handleOpenInQoder = useCallback(() => {
    const variant = getFeatureFlag(FEATURE_FLAGS.ONBOARDING_METHOD_EXPERIMENT);
    trackEvent(ANALYTICS_EVENTS.ONBOARDING_ACTION_TAKEN, {
      action_type: 'install mcp',
      experiment_variant: variant,
      method: 'terminal',
      agent_id: 'qoder',
      install_type: 'deeplink',
    });
    window.open(deeplink, '_blank');
  }, [deeplink]);

  return (
    <button
      onClick={handleOpenInQoder}
      className="flex h-8 items-center justify-center gap-2.5 rounded border border-[var(--alpha-8)] bg-semantic-0 px-4 text-sm font-medium text-foreground transition-colors hover:bg-[var(--alpha-4)]"
    >
      <QoderLogo className="h-6 w-6" />
      <span>{t('overview.addToAgent', { agent: 'Qoder', defaultValue: 'Add to {{agent}}' })}</span>
    </button>
  );
}
