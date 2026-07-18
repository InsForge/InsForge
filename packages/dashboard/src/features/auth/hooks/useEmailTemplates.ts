import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ListEmailTemplatesResponse, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';
import { emailTemplateService } from '#features/auth/services/email-template.service';
import { useToast } from '@insforge/ui';

export function useEmailTemplates(providerType: string = 'custom_smtp') {
  const { t } = useTranslation('chrome');
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch email templates
  const { data, isLoading, error, refetch } = useQuery<ListEmailTemplatesResponse>({
    queryKey: ['email-templates', providerType],
    queryFn: () => emailTemplateService.getTemplates(providerType),
  });

  // Mutation to update an email template
  const updateTemplateMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: UpdateEmailTemplateRequest }) =>
      emailTemplateService.updateTemplate(type, data, providerType),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email-templates', providerType] });
      showToast(
        t('auth.emailTemplateUpdatedToast', {
          defaultValue: 'Email template updated successfully',
        }),
        'success'
      );
    },
    onError: (error: Error) => {
      showToast(
        error.message ||
          t('auth.emailTemplateUpdateFailed', {
            defaultValue: 'Failed to update email template',
          }),
        'error'
      );
    },
  });

  return {
    // Data
    templates: data?.data ?? [],

    // Loading states
    isLoading,
    isUpdating: updateTemplateMutation.isPending,

    // Errors
    error,

    // Actions
    updateTemplate: updateTemplateMutation.mutate,
    refetch,
  };
}
