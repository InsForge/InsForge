import { Rocket } from 'lucide-react';

export default function DeploymentsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-[8px] bg-neutral-100 dark:bg-[#333333]">
      <Rocket size={40} className="text-neutral-400 dark:text-neutral-600" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">No deployments yet</p>
        <p className="text-neutral-500 dark:text-neutral-400 text-xs">
          Deployments will appear here when you deploy your application
        </p>
      </div>
    </div>
  );
}
