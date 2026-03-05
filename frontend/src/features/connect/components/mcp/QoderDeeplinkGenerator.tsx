import { useMemo, useCallback } from 'react';
import { createMCPServerConfig, type PlatformType } from './helpers';
import QoderLogo from '@/assets/logos/qoder.svg?react';
import { getBackendUrl } from '@/lib/utils/utils';
import { trackPostHog, getFeatureFlag } from '@/lib/analytics/posthog';

interface QoderDeeplinkGeneratorProps {
  apiKey?: string;
  os?: PlatformType;
}

export function QoderDeeplinkGenerator({
  apiKey,
  os = 'macos-linux',
}: QoderDeeplinkGeneratorProps) {
  const deeplink = useMemo(() => {
    const config = createMCPServerConfig(apiKey || '', os, getBackendUrl());
    const configString = JSON.stringify(config);
    // Qoder requires: JSON.stringify -> encodeURIComponent -> btoa -> encodeURIComponent
    const base64Config = btoa(encodeURIComponent(configString));
    return `qoder://aicoding.aicoding-deeplink/mcp/add?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }, [apiKey, os]);

  const handleOpenInQoder = useCallback(() => {
    const variant = getFeatureFlag('onboarding-method-experiment');
    trackPostHog('onboarding_action_taken', {
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
      <span>Add to Qoder</span>
    </button>
  );
}
