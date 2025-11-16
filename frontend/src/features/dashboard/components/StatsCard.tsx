import { Card, CardContent } from '@/components/radix/Card';
import { Skeleton } from '@/components/radix/Skeleton';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  icon: LucideIcon;
  title: string;
  value: string | number;
  unit: string;
  description: string;
  isLoading?: boolean;
}

export function StatsCard({
  icon: Icon,
  title,
  value,
  unit,
  description,
  isLoading,
}: StatsCardProps) {
  return (
    <Card className="flex-1 rounded-lg border border-light-mode-border dark:border-dark-mode-border shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] h-full">
      <CardContent className="px-8 py-6 h-full flex flex-col gap-6">
        <div className="flex items-center gap-2 h-7">
          <Icon className="w-5 h-5 text-light-mode-icon dark:text-dark-mode-icon" />
          <span className="text-base font-normal">{title}</span>
        </div>

        <div className="flex flex-col gap-2">
          {isLoading ? (
            <Skeleton className="h-8 w-24 bg-light-mode-secondary dark:bg-dark-mode-secondary" />
          ) : (
            <p className="text-2xl font-normal tracking-[-0.144px] leading-8">
              {value}{' '}
              <span className="text-sm font-normal text-light-mode-text dark:text-dark-mode-text leading-6">
                {unit}
              </span>
            </p>
          )}

          {isLoading ? (
            <Skeleton className="h-6 w-32 bg-light-mode-secondary dark:bg-dark-mode-secondary" />
          ) : (
            <p className="text-base text-light-mode-text dark:text-dark-mode-text leading-6">
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
