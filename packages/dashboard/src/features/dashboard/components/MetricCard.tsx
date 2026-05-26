import { ExternalLink } from 'lucide-react';
import { type ReactNode } from 'react';

export interface MetricCardProps {
  label: string;
  value: string;
  subValueLeft?: string;
  subValueRight?: string;
  icon: ReactNode;
  onNavigate?: () => void;
}

export function MetricCard({
  label,
  value,
  subValueLeft,
  subValueRight,
  icon,
  onNavigate,
}: MetricCardProps) {
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
      <div className="flex h-[120px] flex-col p-4">
        <div className="flex h-[22px] items-center gap-1.5">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
            {icon}
          </div>
          <p className="flex-1 text-[13px] leading-[22px] text-muted-foreground">{label}</p>
          {onNavigate && (
            <button
              type="button"
              onClick={onNavigate}
              aria-label={`Open ${label}`}
              className="flex shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-[38px] flex items-baseline justify-between">
          <div className="flex items-baseline gap-1">
            <p className="text-[20px] font-medium leading-7 text-foreground">{value}</p>
            {subValueLeft && (
              <span className="text-[13px] leading-[22px] text-muted-foreground">
                {subValueLeft}
              </span>
            )}
          </div>
          {subValueRight && (
            <span className="text-[13px] leading-[22px] text-muted-foreground">
              {subValueRight}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
