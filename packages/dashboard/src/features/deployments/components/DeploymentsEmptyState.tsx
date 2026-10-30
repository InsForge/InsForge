import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function DeploymentsEmptyState() {
  const { t } = useTranslation('chrome');
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center gap-3 rounded-[8px] bg-neutral-100 dark:bg-[#333333]">
      <Globe size={40} className="text-neutral-400 dark:text-neutral-600" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">
          {t('deployments.noDeploymentsYet', { defaultValue: 'No deployments yet' })}
        </p>
        <p className="text-neutral-500 dark:text-neutral-400 text-xs">
          {t('deployments.emptyStateHint', {
            defaultValue: 'Your site will appear here when you deploy your application',
          })}
        </p>
      </div>
    </div>
  );
}
