import { Label } from '@/components/radix/Label';
import { Checkbox } from '@/components/Checkbox';
import { getModalityIcon } from '../../helpers';
import { ModalitySchema } from '@insforge/shared-schemas';

interface ModalityFieldProps {
  fieldType: 'input' | 'output';
  value: ModalitySchema[];
  onChange: (value: ModalitySchema[]) => void;
  isReadOnly?: boolean;
}

const modalityOptions: Array<{
  value: ModalitySchema;
  label: string;
  icon: React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
}> = [
  {
    value: 'text',
    label: 'Text',
    icon: getModalityIcon('text'),
  },
  {
    value: 'image',
    label: 'Image',
    icon: getModalityIcon('image'),
  },
];

export function ModalityField({
  fieldType,
  value,
  onChange,
  isReadOnly = false,
}: ModalityFieldProps) {
  const label = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);

  const handleCheckboxChange = (modalityValue: ModalitySchema, checked: boolean) => {
    if (checked) {
      onChange([...value, modalityValue]);
    } else {
      onChange(value.filter((v) => v !== modalityValue));
    }
  };

  if (isReadOnly) {
    return (
      <div className="flex flex-row gap-10 items-center">
        <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
          {label} <span className="text-red-500">*</span>
        </Label>
        <div className="w-full flex items-center h-9 px-3 py-2 text-sm bg-zinc-50 dark:bg-neutral-900 border border-zinc-200 dark:border-neutral-700 rounded-md text-zinc-600 dark:text-zinc-400">
          {value.length > 0 ? value.join(', ') : 'None selected'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row gap-10 items-center">
      <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
        {label} <span className="text-red-500">*</span>
      </Label>
      <div className="w-full flex flex-row gap-10">
        {modalityOptions.map((option) => {
          const isChecked = value.includes(option.value);

          return (
            <div key={option.value} className="flex items-center space-x-2">
              <Checkbox
                checked={isChecked}
                onChange={(checked: boolean) => handleCheckboxChange(option.value, checked)}
                className="data-[state=checked]:bg-zinc-950 data-[state=checked]:border-zinc-950 dark:data-[state=checked]:bg-emerald-300 dark:data-[state=checked]:border-emerald-300"
              />
              <Label
                className="flex items-center gap-2 text-sm font-normal text-zinc-950 dark:text-neutral-50 cursor-pointer"
                onClick={() => handleCheckboxChange(option.value, !isChecked)}
              >
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
