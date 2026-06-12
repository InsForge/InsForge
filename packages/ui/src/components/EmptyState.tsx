import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../lib';

export interface EmptyStateProps {
  /** Lucide icon component, rendered large above the title. */
  icon?: LucideIcon;
  /** Image source URL, used when no icon is given. */
  image?: string;
  /** Arbitrary visual (e.g. an inline SVG component), used when no icon or image is given. */
  visual?: ReactNode;
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
  visual,
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
      {visual && !Icon && !image && visual}
      <h3 className="text-sm font-medium">{title}</h3>
      {description && <p className="text-xs max-w-sm">{description}</p>}
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  );
}
