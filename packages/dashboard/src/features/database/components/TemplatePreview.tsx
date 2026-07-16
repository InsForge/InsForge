import { Button } from '@insforge/ui';
import { useTranslation } from 'react-i18next';
import { DatabaseTemplate } from '#features/database/templates';
import { SchemaVisualizer } from '#features/visualizer/components/SchemaVisualizer';
import { useRawSQL } from '#features/database/hooks/useRawSQL';

interface TemplatePreviewProps {
  template: DatabaseTemplate;
  onCancel: () => void;
}

export function TemplatePreview({ template, onCancel }: TemplatePreviewProps) {
  const { t } = useTranslation('chrome');
  const { executeSQL, isPending } = useRawSQL({
    showSuccessToast: true,
    showErrorToast: true,
    onSuccess: () => {
      // Close preview after successful implementation
      onCancel();
    },
  });

  const handleImplementTemplate = () => {
    executeSQL({ query: template.sql });
  };

  return (
    <div className="flex flex-col h-full bg-bg-gray dark:bg-neutral-800">
      {/* Top Bar */}
      <div className="flex items-center justify-center gap-3 h-12 px-4 border-b border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
        <p className="text-sm font-normal text-zinc-600 dark:text-neutral-400">
          {t('database.previewingTemplate', { defaultValue: 'You are previewing a template' })}
        </p>
        <Button variant="secondary" onClick={onCancel} className="px-4">
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button className="px-4 font-medium" onClick={handleImplementTemplate} disabled={isPending}>
          {isPending
            ? t('database.implementing', { defaultValue: 'Implementing...' })
            : t('database.implementTemplate', { defaultValue: 'Implement Template' })}
        </Button>
      </div>

      {/* Visualizer Content */}
      <div className="relative flex-1 overflow-hidden">
        {/* Dot Matrix Background - Light Mode */}
        <div
          className="absolute inset-0 opacity-50 dark:hidden"
          style={{
            backgroundImage: `radial-gradient(circle, #D1D5DB 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />
        {/* Dot Matrix Background - Dark Mode */}
        <div
          className="absolute inset-0 opacity-50 hidden dark:block"
          style={{
            backgroundImage: `radial-gradient(circle, #3B3B3B 1px, transparent 1px)`,
            backgroundSize: '12px 12px',
          }}
        />

        {/* SchemaVisualizer */}
        <div className="relative z-10 w-full h-full">
          <SchemaVisualizer
            externalSchemas={template.visualizerSchema}
            metadata={{
              auth: {
                providers: [],
                customProviders: [],
              },
              database: {
                tables: [],
                totalSizeInGB: 0,
              },
              storage: {
                buckets: [],
                totalSizeInGB: 0,
              },
            }}
            showControls={false}
            showMiniMap={false}
          />
        </div>
      </div>
    </div>
  );
}
