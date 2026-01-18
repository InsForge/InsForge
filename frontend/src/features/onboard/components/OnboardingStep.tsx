import { useState, useEffect, ReactNode } from 'react';
import { ChevronDown, ChevronRight, CircleCheckBig, Circle } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { Button } from '@/components';

interface OnboardingStepProps {
  stepNumber: number;
  title: string;
  isCompleted: boolean;
  children: ReactNode;
  onNext?: () => void;
}

export function OnboardingStep({
  stepNumber,
  title,
  isCompleted,
  children,
  onNext,
}: OnboardingStepProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (!isCompleted) {
      setIsExpanded(true);
    }
  }, [isCompleted]);

  const canToggle = isCompleted;

  const handleToggle = () => {
    if (canToggle) {
      setIsExpanded(!isExpanded);
    }
  };

  const handleNext = () => {
    onNext?.();
    setIsExpanded(false);
  };

  return (
    <div className="bg-[#333333] border border-neutral-700 rounded-lg overflow-hidden p-4">
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between w-full',
          canToggle && 'cursor-pointer hover:bg-neutral-750'
        )}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          {isCompleted ? (
            <CircleCheckBig className="w-5 h-5 text-emerald-300" />
          ) : (
            <Circle className="w-5 h-5 text-neutral-500" />
          )}

          {/* Step title */}
          <span className="inline-flex items-center gap-1 text-white text-base font-medium">
            <span className="text-neutral-400">Step{stepNumber}</span>
            <span>{title}</span>
          </span>
        </div>

        {/* Expand/Collapse indicator - only for completed steps */}
        {canToggle && (
          <div className="text-neutral-400">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
          </div>
        )}
      </div>

      {/* Content - collapsible */}
      {isExpanded && <div className="mt-2">{children}</div>}
      {isExpanded && onNext && (
        <div className="mt-6 w-full flex items-center justify-end">
          <Button
            onClick={handleNext}
            className="w-30 h-8 px-3 py-0 bg-emerald-300 text-black text-sm font-medium hover:bg-emerald-400"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
