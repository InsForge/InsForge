import { Checkbox, Label } from '@/components';
import { ModalitySchema } from '@insforge/shared-schemas';

interface ModalityFilterSidebarProps {
  inputModalities: ModalitySchema[];
  outputModalities: ModalitySchema[];
  onInputChange: (modalities: ModalitySchema[]) => void;
  onOutputChange: (modalities: ModalitySchema[]) => void;
}

const modalityOptions: Array<{
  value: ModalitySchema;
  label: string;
}> = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'audio', label: 'Audio' },
];

export function ModalityFilterSidebar({
  inputModalities,
  outputModalities,
  onInputChange,
  onOutputChange,
}: ModalityFilterSidebarProps) {
  const handleModalityToggle = (
    type: 'input' | 'output',
    modality: ModalitySchema,
    checked: boolean
  ) => {
    const currentModalities = type === 'input' ? inputModalities : outputModalities;
    const setModalities = type === 'input' ? onInputChange : onOutputChange;

    if (checked) {
      setModalities([...currentModalities, modality]);
    } else {
      setModalities(currentModalities.filter((m) => m !== modality));
    }
  };

  return (
    <div className="w-30 flex-shrink-0 flex flex-col gap-6">
      <p className="text-base font-medium text-zinc-950 dark:text-neutral-50">Filters</p>

      {/* Input Section */}
      <div className="flex flex-col gap-3">
        <Label className="text-sm font-normal text-zinc-950 dark:text-neutral-50 block">
          Input
        </Label>
        <div className="flex flex-col gap-4">
          {modalityOptions.map((option) => {
            const isChecked = inputModalities.includes(option.value);
            return (
              <div key={option.value} className="flex items-center gap-x-2">
                <Checkbox
                  checked={isChecked}
                  onChange={(checked: boolean) =>
                    handleModalityToggle('input', option.value, checked)
                  }
                />
                <Label
                  className="text-sm font-normal text-zinc-950 dark:text-white cursor-pointer"
                  onClick={() => handleModalityToggle('input', option.value, !isChecked)}
                >
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
      </div>

      {/* Output Section */}
      <div className="flex flex-col gap-3">
        <Label className="text-sm font-normal text-zinc-950 dark:text-neutral-50 block">
          Output
        </Label>
        <div className="flex flex-col gap-4">
          {modalityOptions.map((option) => {
            const isChecked = outputModalities.includes(option.value);
            return (
              <div key={option.value} className="flex items-center gap-x-2">
                <Checkbox
                  checked={isChecked}
                  onChange={(checked: boolean) =>
                    handleModalityToggle('output', option.value, checked)
                  }
                />
                <Label
                  className="text-sm font-normal text-zinc-950 dark:text-white cursor-pointer"
                  onClick={() => handleModalityToggle('output', option.value, !isChecked)}
                >
                  {option.label}
                </Label>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
