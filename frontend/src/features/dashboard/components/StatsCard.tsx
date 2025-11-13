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
    <Card className="flex-1 bg-white dark:bg-[#333333] rounded-lg border border-gray-200 dark:border-neutral-700 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.1)] h-full">
      <CardContent className="px-8 py-6 h-full flex flex-col gap-6">
        <div className="flex items-center gap-2 h-7">
          <Icon className="w-5 h-5 text-gray-700 dark:text-neutral-400" />
          <span className="text-base font-normal text-gray-900 dark:text-white">{title}</span>
        </div>

        <div className="flex flex-col gap-2">
          {isLoading ? (
            <Skeleton className="h-8 w-24 bg-gray-200 dark:bg-neutral-700" />
          ) : (
            <p className="text-2xl font-normal text-gray-900 dark:text-white tracking-[-0.144px] leading-8">
              {value}{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-neutral-400 leading-6">
                {unit}
              </span>
            </p>
          )}

          {isLoading ? (
            <Skeleton className="h-6 w-32 bg-gray-200 dark:bg-neutral-700" />
          ) : (
            <p className="text-base text-gray-500 dark:text-neutral-400 leading-6">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
