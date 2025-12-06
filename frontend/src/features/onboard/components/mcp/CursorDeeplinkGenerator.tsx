import { useMemo } from 'react';
import { createMCPServerConfig, type PlatformType } from './helpers';
import CursorLogo from '@/assets/logos/cursor.svg?react';
import { getBackendUrl } from '@/lib/utils/utils';

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

  const handleOpenInCursor = () => {
    window.open(deeplink, '_blank');
  };

  return (
    <button
      onClick={handleOpenInCursor}
      className="h-8 bg-black dark:bg-white px-4 flex items-center justify-center gap-2.5 rounded text-white dark:text-black text-sm font-medium"
    >
      <CursorLogo className="h-6 w-6" />
      <span>Add to Cursor</span>
    </button>
  );
}
