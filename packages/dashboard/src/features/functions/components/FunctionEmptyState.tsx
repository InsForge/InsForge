import { Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function FunctionEmptyState() {
  const { t } = useTranslation('chrome');
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <Code2 size={40} className="text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {t('functions.noFunctionsTitle', { defaultValue: 'No functions available' })}
        </p>
        <p className="text-muted-foreground text-xs">
          {t('functions.noFunctionsDescription', {
            defaultValue: 'No edge functions have been created yet',
          })}
        </p>
      </div>
    </div>
  );
}
