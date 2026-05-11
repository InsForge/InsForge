import { useLocation } from 'react-router-dom';
import { FeatureSidebar, type FeatureSidebarListItem } from '#components';

const AI_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/dashboard/ai/overview',
  },
  {
    id: 'quick-start',
    label: 'Quick Start',
  },
  {
    id: 'ai-models',
    label: 'Models',
    href: '/dashboard/ai/models',
  },
];

export function AISidebar() {
  const location = useLocation();
  const activeItemId = location.pathname.endsWith('/models') ? 'ai-models' : 'overview';

  return (
    <FeatureSidebar title="Model Gateway" items={AI_SIDEBAR_ITEMS} activeItemId={activeItemId} />
  );
}
