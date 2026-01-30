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
    const variant = getFeatureFlag('onboard-test-2');
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
      className="h-8 bg-black hover:bg-neutral-800 dark:bg-neutral-600 dark:hover:bg-neutral-500 px-4 flex items-center justify-center gap-2.5 rounded text-white text-sm font-medium"
    >
      <QoderLogo className="h-6 w-6" />
      <span>Add to Qoder</span>
    </button>
  );
}
