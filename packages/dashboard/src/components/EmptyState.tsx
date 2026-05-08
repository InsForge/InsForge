import { LucideIcon } from 'lucide-react';
import { Button } from '@insforge/ui';
import { cn } from '#lib/utils/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  image?: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  image,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'text-center flex flex-col items-center justify-center text-zinc-500',
        className
      )}
    >
      {Icon && <Icon className="mx-auto h-50 w-50 text-muted-foreground" />}
      {image && !Icon && (
        <img src={image} alt={title} className="mx-auto h-50 w-50 object-contain" />
      )}
      <h3 className="text-sm font-medium">{title}</h3>
      {description && <p className="text-xs max-w-sm">{description}</p>}
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
