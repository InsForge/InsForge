import * as React from 'react';
import { cn } from '../lib';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-card/10', className)} {...props} />;
}

export { Skeleton };
