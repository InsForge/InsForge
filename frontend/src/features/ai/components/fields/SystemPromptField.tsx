import { UseFormRegister, FieldError, FieldValues, Path } from 'react-hook-form';
import { Label } from '@/components/radix/Label';
import { Textarea } from '@/components/radix/Textarea';

interface SystemPromptFieldProps<T extends FieldValues> {
  register: UseFormRegister<T>;
  error?: FieldError;
}

export function SystemPromptField<T extends FieldValues>({ register, error }: SystemPromptFieldProps<T>) {
  return (
    <div className="flex flex-row gap-10 items-start">
      <Label
        htmlFor="systemPrompt"
        className="text-sm font-normal text-zinc-950 dark:text-neutral-50 whitespace-nowrap"
      >
        System Prompt
      </Label>
      <div className="flex flex-col gap-1 w-full">
        <Textarea
          id="systemPrompt"
          {...register('systemPrompt' as Path<T>)}
          placeholder="Enter system prompt..."
          className="w-full min-h-[160px] resize-none bg-transparent dark:bg-neutral-900 dark:text-white dark:placeholder:text-neutral-400 dark:border-neutral-700"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-500">{error.message}</p>}
      </div>
    </div>
  );
}
