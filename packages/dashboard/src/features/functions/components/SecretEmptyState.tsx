import { Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SecretEmptyStateProps {
  searchQuery: string;
}

export default function SecretEmptyState({ searchQuery }: SecretEmptyStateProps) {
  const { t } = useTranslation('chrome');
  return (
    <div className="flex flex-col items-center justify-center py-8 rounded-lg bg-[var(--alpha-4)]">
      <Key className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">
          {searchQuery
            ? t('functions.noMatchingSecrets', { defaultValue: 'No matching secrets found' })
            : t('functions.noSecretsConfigured', { defaultValue: 'No secrets configured' })}
        </p>
        <p className="text-muted-foreground text-sm">
          {searchQuery
            ? t('functions.adjustSearchTerms', { defaultValue: 'Try adjusting your search terms' })
            : t('functions.createSecretsDescription', {
                defaultValue: 'Create environment variables for your edge functions',
              })}
        </p>
      </div>
    </div>
  );
}
