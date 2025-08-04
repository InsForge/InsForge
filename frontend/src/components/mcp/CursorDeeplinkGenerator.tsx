import { useMemo } from 'react';
import CursorLogoIcon from '@/assets/icons/cursor_logo.svg';
import { createMCPServerConfig, type PlatformType } from '@/components/mcp/mcp-agents';

interface CursorDeeplinkGeneratorProps {
  apiKey?: string;
  apiBaseUrl?: string;
  os?: PlatformType;
}

export function CursorDeeplinkGenerator({
  apiKey,
  apiBaseUrl = 'http://localhost:7130',
  os = 'macos-linux',
}: CursorDeeplinkGeneratorProps) {
  const deeplink = useMemo(() => {
    const config = createMCPServerConfig(apiKey || '', os, apiBaseUrl);
    const configString = JSON.stringify(config);
    const base64Config = btoa(configString);
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=insforge&config=${encodeURIComponent(base64Config)}`;
  }, [apiKey, apiBaseUrl, os]);

  const handleOpenInCursor = () => {
    window.open(deeplink, '_blank');
  };

  return (
    <button
      onClick={handleOpenInCursor}
      className="bg-black py-2 px-4 flex items-center justify-center gap-2.5 rounded-md text-white text-sm font-medium"
    >
      <img src={CursorLogoIcon} alt="Add to Cursor" className="h-6 w-6" />
      <span>Add to Cursor</span>
    </button>
  );
}
