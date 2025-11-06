import { ConfigurationTab } from '@/features/auth/components/ConfigurationTab';

export default function ConfigurationPage() {
  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        <ConfigurationTab />
      </div>
    </div>
  );
}
