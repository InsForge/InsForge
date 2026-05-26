import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

const DEPLOYMENTS_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'deployment-overview',
    label: 'Overview',
    href: '/dashboard/deployments/overview',
  },
  {
    id: 'deployment-logs',
    label: 'Deployment Logs',
    href: '/dashboard/deployments/logs',
  },
  {
    id: 'deployment-env-vars',
    label: 'Environment Variables',
    href: '/dashboard/deployments/env-vars',
  },
  {
    id: 'deployment-domains',
    label: 'Domains',
    href: '/dashboard/deployments/domains',
  },
];

export function DeploymentsSidebar() {
  return <FeatureSidebar title="Deployments" items={DEPLOYMENTS_SIDEBAR_ITEMS} />;
}
