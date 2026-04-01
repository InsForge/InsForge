import { FeatureSidebar, type FeatureSidebarListItem } from '@/components';

const AI_SIDEBAR_ITEMS: FeatureSidebarListItem[] = [
  {
    id: 'ai-models',
    label: 'Models',
    href: '/dashboard/ai',
  },
  {
    id: 'ai-usage',
    label: 'Usage',
    href: '/dashboard/ai/usage',
  },
];

export function AISidebar() {
  return <FeatureSidebar title="Model Gateway" items={AI_SIDEBAR_ITEMS} />;
}
