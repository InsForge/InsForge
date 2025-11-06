import { AuthMethodsTab } from '@/features/auth/components/AuthMethodsTab';

export default function AuthMethodsPage() {
  return (
    <div className="h-full bg-slate-50 dark:bg-neutral-800 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-y-auto">
        <AuthMethodsTab />
      </div>
    </div>
  );
}
