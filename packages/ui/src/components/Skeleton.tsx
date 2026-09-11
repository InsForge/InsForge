import type { HTMLAttributes } from 'react';
import { cn } from '../lib';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // alpha-8 is the one tone that reads on both themes: black over the light page, white over the dark.
  return <div className={cn('animate-pulse rounded-md bg-alpha-8', className)} {...props} />;
}

export { Skeleton };
