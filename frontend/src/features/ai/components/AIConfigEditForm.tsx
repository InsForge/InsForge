import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  updateAIConfigurationRequestSchema,
  UpdateAIConfigurationRequest,
  AIConfigurationWithUsageSchema,
} from '@insforge/shared-schemas';
import { SystemPromptField } from './fields/SystemPromptField';

interface AIConfigEditFormProps {
  editingConfig: AIConfigurationWithUsageSchema;
  onSubmit: (data: UpdateAIConfigurationRequest) => void;
}

export function AIConfigEditForm({ editingConfig, onSubmit }: AIConfigEditFormProps) {
  const form = useForm<UpdateAIConfigurationRequest>({
    resolver: zodResolver(updateAIConfigurationRequestSchema),
    defaultValues: {
      systemPrompt: editingConfig.systemPrompt ?? null,
    },
  });

  const handleFormSubmit = (data: UpdateAIConfigurationRequest) => {
    onSubmit(data);
  };

  return (
    <form
      id="ai-config-form"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit(handleFormSubmit)();
      }}
      className="flex flex-col"
    >
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-6 w-full items-stretch">
          {/* System prompt field */}
          <SystemPromptField<UpdateAIConfigurationRequest>
            register={form.register}
            error={form.formState.errors.systemPrompt}
          />
        </div>
      </div>
    </form>
  );
}
