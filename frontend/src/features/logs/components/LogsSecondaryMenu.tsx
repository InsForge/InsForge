import { useLogSources } from '@/features/logs/hooks/useLogSources';
import { DynamicSecondaryMenuProps, SecondaryMenuItem } from '@/lib/utils/menuConfig';
import { useEffect } from 'react';

/**
 * Dynamic secondary menu component for logs
 * Fetches log sources and converts them to menu items
 */
export function LogsSecondaryMenu({ onItemsChange, onLoading }: DynamicSecondaryMenuProps) {
  const { sourceNames, isLoading } = useLogSources();

  useEffect(() => {
    onLoading?.(isLoading);
  }, [isLoading, onLoading]);

  useEffect(() => {
    // Build menu items from log sources
    const items: SecondaryMenuItem[] = [
      {
        id: 'mcp-logs',
        label: 'MCP logs',
        href: '/dashboard/logs/MCP',
      },
      ...sourceNames.map((source) => ({
        id: `log-${source}`,
        label: source,
        href: `/dashboard/logs/${source}`,
      })),
    ];

    onItemsChange(items);
  }, [sourceNames, onItemsChange]);

  // This component doesn't render anything visible
  // It just manages the dynamic menu items
  return null;
}
