import { useState, useEffect, ReactNode } from 'react';
import { ChevronDown, ChevronRight, CircleCheckBig, Circle } from 'lucide-react';
import { cn } from '@/lib/utils/utils';
import { Button } from '@/components';
import { trackPostHog } from '@/lib/analytics/posthog';
import type { InstallMethod } from './InstallMethodTabs';

interface OnboardingStepProps {
  stepNumber: number;
  title: string;
  isCompleted: boolean;
  children: ReactNode;
  onNext?: () => void;
  experimentVariant?: 'control' | 'test';
  installMethod?: InstallMethod;
}

export function OnboardingStep({
  stepNumber,
  title,
  isCompleted,
  children,
  onNext,
  experimentVariant,
  installMethod,
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
    trackPostHog('onboarding_next_clicked', {
      experiment_variant: experimentVariant,
      current_step: stepNumber,
      method: installMethod,
    });

    onNext?.();
    setIsExpanded(false);
  };

  return (
    <div className="dark:bg-[#333333] bg-neutral-50 border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden p-4">
      {/* Header */}
      <div
        className={cn('flex items-center justify-between w-full', canToggle && 'cursor-pointer')}
        onClick={handleToggle}
      >
        <div className="flex items-center gap-2">
          {/* Status indicator */}
          {isCompleted ? (
            <CircleCheckBig className="w-5 h-5 text-black dark:text-emerald-300" />
          ) : (
            <Circle className="w-5 h-5 text-neutral-500" />
          )}

          {/* Step title */}
          <span className="inline-flex items-center gap-1 dark:text-white text-black text-base font-medium">
            <span className="dark:text-neutral-400 text-gray-500">Step{stepNumber}</span>
            <span>{title}</span>
          </span>
        </div>

        {/* Expand/Collapse indicator - only for completed steps */}
        {canToggle && (
          <div className="dark:text-neutral-400 text-gray-500">
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
            className="w-30 h-8 px-3 py-0 bg-black dark:bg-emerald-300 text-white dark:text-black text-sm font-medium hover:bg-black/80 dark:hover:bg-emerald-400"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
