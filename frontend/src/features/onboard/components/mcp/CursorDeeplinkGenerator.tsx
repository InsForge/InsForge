import { useMemo, useCallback } from 'react';
import { createMCPServerConfig, type PlatformType } from './helpers';
import CursorLogo from '@/assets/logos/cursor.svg?react';
import { getBackendUrl } from '@/lib/utils/utils';
import { trackPostHog, getFeatureFlag } from '@/lib/analytics/posthog';

interface CursorDeeplinkGeneratorProps {
  apiKey?: string;
  os?: PlatformType;
}

export function CursorDeeplinkGenerator({
  apiKey,
  os = 'macos-linux',
}: CursorDeeplinkGeneratorProps) {
  const deeplink = useMemo(() => {
    const config = createMCPServerConfig(apiKey || '', os, getBackendUrl());
    const configString = JSON.stringify(config);
    const base64Config = btoa(configString);
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }, [apiKey, os]);

  const handleOpenInCursor = useCallback(() => {
    const variant = getFeatureFlag('onboard-experiment');
    trackPostHog('onboarding_action_taken', {
      action_type: 'install mcp',
      experiment_variant: variant,
      method: 'terminal',
      agent_id: 'cursor',
      install_type: 'deeplink',
    });
    window.open(deeplink, '_blank');
  }, [deeplink]);

  return (
    <button
      onClick={handleOpenInCursor}
      className="h-8 bg-black hover:bg-neutral-800 dark:bg-neutral-600 dark:hover:bg-neutral-500 px-4 flex items-center justify-center gap-2.5 rounded text-white text-sm font-medium"
    >
      <CursorLogo className="h-6 w-6" />
      <span>Add to Cursor</span>
    </button>
  );
}
