import { EmptyStateIllustration } from './EmptyStateIllustration';

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
      <EmptyStateIllustration />
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
