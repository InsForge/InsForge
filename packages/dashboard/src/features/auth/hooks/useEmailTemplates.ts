import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListEmailTemplatesResponse, UpdateEmailTemplateRequest } from '@insforge/shared-schemas';
import { emailTemplateService } from '#features/auth/services/email-template.service';
import { useToast } from '#lib/hooks/useToast';

export function useEmailTemplates() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  // Query to fetch email templates
  const { data, isLoading, error, refetch } = useQuery<ListEmailTemplatesResponse>({
    queryKey: ['email-templates'],
    queryFn: () => emailTemplateService.getTemplates(),
  });

  // Mutation to update an email template
  const updateTemplateMutation = useMutation({
    mutationFn: ({ type, data }: { type: string; data: UpdateEmailTemplateRequest }) =>
      emailTemplateService.updateTemplate(type, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email-templates'] });
      showToast('Email template updated successfully', 'success');
    },
    onError: (error: Error) => {
      showToast(error.message || 'Failed to update email template', 'error');
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
