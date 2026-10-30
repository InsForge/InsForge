import { useTranslation } from 'react-i18next';
import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

export function DeploymentsSidebar() {
  const { t } = useTranslation('chrome');
  const items: FeatureSidebarListItem[] = [
    {
      id: 'deployment-overview',
      label: t('deployments.overview', { defaultValue: 'Overview' }),
      href: '/dashboard/deployments/overview',
    },
    {
      id: 'deployment-logs',
      label: t('deployments.deploymentLogs', { defaultValue: 'Deployment Logs' }),
      href: '/dashboard/deployments/logs',
    },
    {
      id: 'deployment-env-vars',
      label: t('deployments.environmentVariables', { defaultValue: 'Environment Variables' }),
      href: '/dashboard/deployments/env-vars',
    },
    {
      id: 'deployment-domains',
      label: t('deployments.domains', { defaultValue: 'Domains' }),
      href: '/dashboard/deployments/domains',
    },
  ];
  return (
    <FeatureSidebar
      title={t('deployments.sidebarTitle', { defaultValue: 'Sites' })}
      items={items}
    />
  );
}
