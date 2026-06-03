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
    href: '/dashboard/ai/quick-start',
  },
  {
    id: 'ai-models',
    label: 'Models',
    href: '/dashboard/ai/models',
  },
];

export function AISidebar() {
  return <FeatureSidebar title="Model Gateway" items={AI_SIDEBAR_ITEMS} />;
}
