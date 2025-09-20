import { Label } from '@/components/radix/Label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/radix/Select';
import { getModalityIcon } from '../../helpers';

interface ModalityFieldProps {
  fieldType: 'input' | 'output';
  value: string;
  onChange: (value: string) => void;
  isReadOnly?: boolean;
}

const modalityOptions = [
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

export function ModalityField({ fieldType, value, onChange, isReadOnly = false }: ModalityFieldProps) {
  const label = fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
  const placeholder = `Select ${fieldType} type`;

  if (isReadOnly) {
    return (
      <div className="flex flex-row gap-10 items-center">
        <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
          {label} <span className="text-red-500">*</span>
        </Label>
        <div className="w-full flex items-center h-9 px-3 py-2 text-sm bg-zinc-50 dark:bg-neutral-900 border border-zinc-200 dark:border-neutral-700 rounded-md text-zinc-600 dark:text-zinc-400">
          {value}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row gap-10 items-center">
      <Label className="w-34 text-sm font-normal text-zinc-950 dark:text-neutral-50">
        {label} <span className="text-red-500">*</span>
      </Label>
      <div className="relative w-full">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            id={fieldType}
            className="h-9 bg-transparent dark:bg-neutral-900 dark:border-neutral-700 dark:text-white"
          >
            <SelectValue asChild placeholder={placeholder}>
              {value &&
                (() => {
                  const selectedOption = modalityOptions.find(
                    (option) => option.value === value
                  );
                  if (selectedOption) {
                    return (
                      <div className="flex items-center justify-between w-full mr-2">
                        <span>{selectedOption.label}</span>
                        <selectedOption.icon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                      </div>
                    );
                  }
                  return <span>{value}</span>;
                })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="dark:bg-neutral-900 dark:border-neutral-700">
            {modalityOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="dark:text-white dark:hover:bg-neutral-700"
              >
                <div className="flex items-center justify-between w-full">
                  <span>{option.label}</span>
                  <option.icon className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
