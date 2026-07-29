import { useTranslation } from 'react-i18next';
import { FeatureSidebar } from '#components';
import { useLogSources } from '#features/logs/hooks/useLogSources';

export function LogsSidebar() {
  const { t } = useTranslation('chrome');
  const { menuItems, isLoading } = useLogSources();

  return (
    <FeatureSidebar
      title={t('logs.paneTitle', { defaultValue: 'Logs' })}
      items={menuItems}
      loading={isLoading}
    />
  );
}
