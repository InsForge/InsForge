import { CSSProperties } from 'react';
import EmptyBoxSvg from '#assets/images/empty_box.svg?react';

interface DataGridEmptyStateProps {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function DataGridEmptyState({ message, action }: DataGridEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 pb-12 pt-6 text-center">
      <EmptyBoxSvg
        className="h-[95px] w-[160px]"
        style={
          {
            '--empty-box-fill-primary': 'rgb(var(--semantic-2))',
            '--empty-box-fill-secondary': 'rgb(var(--semantic-6))',
          } as CSSProperties
        }
        aria-hidden="true"
      />
      <p className="text-sm font-medium leading-6 text-muted-foreground">{message}</p>
      {action && (
        <button
          type="button"
          className="text-xs leading-4 text-primary hover:underline"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
