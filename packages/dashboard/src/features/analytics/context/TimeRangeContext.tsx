import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PosthogTimeframe } from '@insforge/shared-schemas';

interface TimeRangeContextValue {
  timeframe: PosthogTimeframe;
  setTimeframe: (t: PosthogTimeframe) => void;
}

const TimeRangeContext = createContext<TimeRangeContextValue | null>(null);

export function TimeRangeProvider({
  children,
  initial = '7d',
}: {
  children: ReactNode;
  initial?: PosthogTimeframe;
}) {
  const [timeframe, setTimeframe] = useState<PosthogTimeframe>(initial);
  return (
    <TimeRangeContext.Provider value={{ timeframe, setTimeframe }}>
      {children}
    </TimeRangeContext.Provider>
  );
}

export function useTimeframe(): PosthogTimeframe {
  const ctx = useContext(TimeRangeContext);
  if (!ctx) {
    throw new Error('useTimeframe must be used inside <TimeRangeProvider>');
  }
  return ctx.timeframe;
}

export function useSetTimeframe(): (t: PosthogTimeframe) => void {
  const ctx = useContext(TimeRangeContext);
  if (!ctx) {
    throw new Error('useSetTimeframe must be used inside <TimeRangeProvider>');
  }
  return ctx.setTimeframe;
}
