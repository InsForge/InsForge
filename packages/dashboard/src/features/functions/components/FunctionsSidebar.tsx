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

export function FunctionsSidebar() {
  return <FeatureSidebar title="Edge Functions" items={FUNCTIONS_SIDEBAR_ITEMS} />;
}
