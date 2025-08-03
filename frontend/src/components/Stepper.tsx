import { cn } from '@/lib/utils/utils';

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
          className={cn('transition-all duration-300', isActive ? 'text-zinc-50' : 'text-zinc-200')}
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
            isActive ? 'text-zinc-400' : 'text-zinc-950'
          )}
          strokeLinecap="round"
        />
      </svg>
      {/* Step number */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={cn(
            'transition-all duration-300',
            isActive ? 'text-zinc-200' : 'text-zinc-950'
          )}
        >
          {currentStep}/{totalSteps}
        </span>
      </div>
    </div>
  );
}

import activeStep from '@/assets/icons/step_active.svg';
import inactiveStep from '@/assets/icons/step_inactive.svg';
import CheckedIcon from '@/assets/icons/checked.svg';

interface LinearStepperProps {
  currentStep: number;
  totalSteps: number;
  stepLabels: readonly string[];
  className?: string;
  isCompleted?: boolean;
}

export function LinearStepper({
  currentStep,
  totalSteps,
  stepLabels,
  className,
}: LinearStepperProps) {
  // Calculate progress percentage
  const progressPercentage = Math.min(((currentStep - 1) / totalSteps) * 100 + currentStep, 100);

  return (
    <div className={cn('w-full space-y-3', className)}>
      {/* Progress Bar */}
      <div className="relative w-full h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full bg-zinc-950 transition-all duration-500 ease-in-out"
          style={{ width: `${progressPercentage}%` }}
        />
      </div>

      {/* Step Labels */}
      <div className="flex justify-start items-center gap-6 w-full">
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const isCompleted = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <div key={stepNumber} className="flex flex-row items-start justify-start gap-1 w-full">
              {/* Step Number */}
              <div className="w-5 h-5 flex items-center justify-center">
                {isCompleted ? (
                  <img src={CheckedIcon} alt="checked" className="w-5 h-5" />
                ) : isCurrent ? (
                  <img src={activeStep} alt="active" className="w-5 h-5" />
                ) : (
                  <img src={inactiveStep} alt="inactive" className="w-5 h-5" />
                )}
              </div>

              {/* Step Label */}
              <span
                className={cn(
                  'text-sm text-center transition-colors duration-300',
                  isCompleted || isCurrent ? 'text-zinc-950' : 'text-zinc-500'
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
