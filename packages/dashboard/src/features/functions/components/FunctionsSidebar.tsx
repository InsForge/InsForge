import { Settings } from 'lucide-react';
import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

const FUNCTIONS_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'functions-list',
    label: 'Edge Functions',
    href: '/dashboard/functions/list',
  },
  {
    id: 'secrets',
    label: 'Secrets',
    href: '/dashboard/functions/secrets',
  },
  {
    id: 'schedules',
    label: 'Schedules',
    href: '/dashboard/functions/schedules',
  },
];

interface FunctionsSidebarProps {
  onOpenSettings: () => void;
}

export function FunctionsSidebar({ onOpenSettings }: FunctionsSidebarProps) {
  return (
    <FeatureSidebar
      title="Edge Functions"
      items={FUNCTIONS_SIDEBAR_ITEMS}
      headerButtons={[
        {
          id: 'functions-settings',
          label: 'Functions settings',
          icon: Settings,
          onClick: onOpenSettings,
        },
      ]}
    />
  );
}
