import { useState, useEffect, ReactNode } from 'react';
import { CircleCheckBig, Clock } from 'lucide-react';
import { Button } from '@/components';
import { trackPostHog } from '@/lib/analytics/posthog';
import type { InstallMethod } from './InstallMethodTabs';

interface OnboardingStepProps {
  stepNumber: number;
  title: string;
  isCompleted: boolean;
  children: ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  experimentVariant: 'control' | 'test';
  installMethod?: InstallMethod;
}

export function OnboardingStep({
  stepNumber,
  title,
  isCompleted,
  children,
  onNext,
  onBack,
  experimentVariant,
  installMethod,
}: OnboardingStepProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Expand the step when it becomes active (not completed)
  useEffect(() => {
    if (!isCompleted) {
      setIsExpanded(true);
    }
  }, [isCompleted]);

  const handleNext = () => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'next step',
      experiment_variant: experimentVariant,
      step: stepNumber,
      method: installMethod,
    });

    onNext?.();
    setIsExpanded(false);
  };

  const handleBack = () => {
    trackPostHog('onboarding_action_taken', {
      action_type: 'back step',
      experiment_variant: experimentVariant,
      step: stepNumber,
      method: installMethod,
    });

    onBack?.();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Step container */}
      <div className="dark:bg-[#333333] bg-neutral-50 border border-gray-200 dark:border-neutral-700 rounded-lg overflow-hidden p-4">
        {/* Header */}
        <div className="flex items-center w-full">
          <div className="flex items-center gap-2">
            {/* Status indicator */}
            {isCompleted ? (
              <CircleCheckBig className="w-5 h-5 text-black dark:text-emerald-300" />
            ) : (
              <Clock className="w-5 h-5 text-neutral-500" />
            )}

            {/* Step title */}
            <span className="inline-flex items-center gap-1 dark:text-white text-black text-base font-medium">
              <span className="dark:text-neutral-400 text-gray-500">Step{stepNumber}</span>
              <span>{title}</span>
            </span>
          </div>
        </div>

        {/* Content - collapsible */}
        {isExpanded && <div className="mt-2">{children}</div>}
      </div>

      {/* Action buttons - outside the container */}
      {isExpanded && (onNext || onBack) && (
        <div className="w-full flex items-center justify-end gap-3">
          {onBack && (
            <Button
              onClick={handleBack}
              className="w-[120px] h-8 px-3 py-0 bg-gray-200 dark:bg-neutral-600 text-black dark:text-white text-sm font-medium hover:bg-gray-300 dark:hover:bg-neutral-500"
            >
              Back
            </Button>
          )}
          {onNext && (
            <Button
              onClick={handleNext}
              className="w-[120px] h-8 px-3 py-0 bg-black dark:bg-emerald-300 text-white dark:text-black text-sm font-medium hover:bg-black/80 dark:hover:bg-emerald-400"
            >
              Next
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
