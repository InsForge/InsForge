import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

const FUNCTIONS_SIDEBAR_BASE_ITEMS = [
  {
    id: 'functions-list',
    labelKey: 'edgeFunctions',
    defaultLabel: 'Edge Functions',
    href: '/dashboard/functions/list',
  },
  {
    id: 'secrets',
    labelKey: 'secrets',
    defaultLabel: 'Secrets',
    href: '/dashboard/functions/secrets',
  },
  {
    id: 'schedules',
    labelKey: 'schedules',
    defaultLabel: 'Schedules',
    href: '/dashboard/functions/schedules',
  },
] as const;

interface FunctionsSidebarProps {
  onOpenSettings: () => void;
}

export function FunctionsSidebar({ onOpenSettings }: FunctionsSidebarProps) {
  const { t } = useTranslation('chrome');

  const items: FeatureSidebarListItem[] = FUNCTIONS_SIDEBAR_BASE_ITEMS.map((item) => ({
    id: item.id,
    label: t(`functions.${item.labelKey}`, { defaultValue: item.defaultLabel }),
    href: item.href,
  }));

  return (
    <FeatureSidebar
      title={t('functions.edgeFunctions', { defaultValue: 'Edge Functions' })}
      items={items}
      headerButtons={[
        {
          id: 'functions-settings',
          label: t('functions.functionsSettings', { defaultValue: 'Functions settings' }),
          icon: Settings,
          onClick: onOpenSettings,
        },
      ]}
    />
  );
}
