import { cn } from '../lib/utils/utils';

interface CircularStepperProps {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  size?: number;
}

export function CircularStepper({
  isActive,
  currentStep,
  totalSteps,
  size = 40,
}: CircularStepperProps) {
  const radius = (size - 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (currentStep / totalSteps) * circumference;

  return (
    <div className="relative [&_svg]:w-full [&_svg]:h-full" style={{ width: size, height: size }}>
      {/* Background circle */}
      <svg className="absolute inset-0 transform">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className={cn(
            'transition-all duration-300',
            isActive ? 'text-zinc-50' : 'text-zinc-200 dark:text-zinc-500'
          )}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          className={cn(
            'transition-all duration-300',
            isActive ? 'text-zinc-400 dark:text-zinc-800' : 'text-zinc-950 dark:text-emerald-300'
          )}
          strokeLinecap="round"
        />
      </svg>
      {/* Step number */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            'transition-all duration-300',
            isActive ? 'text-zinc-200 dark:text-zinc-800' : 'text-zinc-950 dark:text-white'
          )}
        >
          {currentStep}/{totalSteps}
        </span>
      </div>
    </div>
  );
}

import ActiveStep from '../assets/icons/step_active.svg?react';
import InactiveStep from '../assets/icons/step_inactive.svg?react';
import CheckedIcon from '../assets/icons/checked.svg?react';

interface LinearStepperProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: readonly string[];
  className?: string;
  isCompleted: boolean;
}

export function LinearStepper({
  currentStep,
  totalSteps,
  stepLabels,
  className,
  isCompleted,
}: LinearStepperProps) {
  // Calculate progress percentage
  const progressPercentage = isCompleted
    ? 100
    : Math.min(((currentStep - 1) / totalSteps) * 100 + currentStep, 100);

  return (
    <div className={cn('w-full space-y-3', className)}>
      {/* Progress Bar */}
      <div className="relative w-full h-2 bg-zinc-200 dark:bg-zinc-600 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-zinc-950 dark:bg-white transition-all duration-500 ease-in-out"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Step Labels */}
      <div className="flex justify-start items-center gap-6 w-full">
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const stepIsCompleted = stepNumber < currentStep || isCompleted;
          const isCurrent = stepNumber === currentStep;

          return (
            <div key={stepNumber} className="flex flex-row items-start justify-start gap-1 w-full">
              {/* Step Number */}
              <div className="w-5 h-5 flex items-center justify-center">
                {stepIsCompleted ? (
                  <CheckedIcon className="w-5 h-5" />
                ) : isCurrent ? (
                  <ActiveStep className="w-5 h-5 dark:text-white" />
                ) : (
                  <InactiveStep className="w-5 h-5 dark:text-neutral-400" />
                )}
              </div>

              {/* Step Label */}
              <span
                className={cn(
                  'text-sm text-center transition-colors duration-300',
                  stepIsCompleted || isCurrent
                    ? 'text-zinc-950 dark:text-white'
                    : 'text-zinc-500 dark:text-neutral-400'
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface VerticalStepperProps {
  currentStep: number;
  stepLabels: readonly string[];
  className?: string;
}

export function VerticalStepper({ currentStep, stepLabels, className }: VerticalStepperProps) {
  return (
    <div className={cn('flex flex-col gap-0', className)}>
      {stepLabels.map((label, index) => {
        const stepNumber = index + 1;
        const isCurrent = stepNumber === currentStep;
        const isLast = index === stepLabels.length - 1;

        return (
          <div key={stepNumber} className="flex flex-row items-start gap-3">
            {/* Step indicator column */}
            <div className="flex flex-col items-center">
              {/* Circle with number */}
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors',
                  isCurrent
                    ? 'bg-zinc-950 dark:bg-white text-white dark:text-black'
                    : 'bg-zinc-200 dark:bg-neutral-700 text-zinc-500 dark:text-neutral-400'
                )}
              >
                {stepNumber}
              </div>
              {/* Connecting line */}
              {!isLast && <div className="w-0.5 h-20 bg-zinc-200 dark:bg-neutral-700" />}
            </div>

            {/* Step label */}
            <div className={cn('pt-2', !isLast && 'pb-20')}>
              <span
                className={cn(
                  'text-base font-medium transition-colors',
                  isCurrent
                    ? 'text-zinc-950 dark:text-white'
                    : 'text-zinc-500 dark:text-neutral-400'
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
