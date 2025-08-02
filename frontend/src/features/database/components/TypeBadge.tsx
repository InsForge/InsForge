import { cn, mapDatabaseTypeToFieldType } from '@/lib/utils/utils';

interface TypeBadgeProps {
  type: string;
  className?: string;
}

export function TypeBadge({ type, className }: TypeBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center px-1.5 py-0.5 rounded-md',
        'bg-white border border-zinc-200',
        className
      )}
    >
      <span className="text-xs font-normal text-zinc-500">{mapDatabaseTypeToFieldType(type)}</span>
    </div>
  );
}
