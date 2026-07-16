import { useTranslation } from 'react-i18next';
import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

export function AISidebar() {
  const { t } = useTranslation('chrome');

  const items: FeatureSidebarListItem[] = [
    {
      id: 'overview',
      label: t('ai.sidebar.overview', { defaultValue: 'Overview' }),
      href: '/dashboard/ai/overview',
    },
    {
      id: 'quick-start',
      label: t('ai.sidebar.quickStart', { defaultValue: 'Quick Start' }),
      href: '/dashboard/ai/quick-start',
    },
    {
      id: 'ai-models',
      label: t('ai.sidebar.models', { defaultValue: 'Models' }),
      href: '/dashboard/ai/models',
    },
  ];

  return (
    <FeatureSidebar
      title={t('ai.sidebar.title', { defaultValue: 'Model Gateway' })}
      items={items}
    />
  );
}
