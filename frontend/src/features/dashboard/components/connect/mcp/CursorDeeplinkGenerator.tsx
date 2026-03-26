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
    const variant = getFeatureFlag('onboarding-method-experiment');
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
      className="flex h-8 items-center justify-center gap-2.5 rounded border border-[var(--alpha-8)] bg-semantic-0 px-4 text-sm font-medium text-foreground transition-colors hover:bg-[var(--alpha-4)]"
    >
      <CursorLogo className="h-6 w-6" />
      <span>Add to Cursor</span>
    </button>
  );
}
