import { useState, useEffect } from 'react';

export const STEP_DESCRIPTIONS = [
  'Install Node.js',
  'Install InsForge',
  'Test the Connection',
  'Start Using InsForge',
] as const;

export type OnboardStep = 1 | 2 | 3 | 4;

const ONBOARD_STORAGE_KEY = 'insforge_onboard_step';

export function useOnboardStep() {
  const [currentStep, setCurrentStep] = useState<OnboardStep>(1);

  // Load current step from localStorage
  useEffect(() => {
    const savedStep = localStorage.getItem(ONBOARD_STORAGE_KEY);
    if (savedStep) {
      const step = parseInt(savedStep, 10) as OnboardStep;
      if (step >= 1 && step <= 4) {
        setCurrentStep(step);
      }
    }
  }, []);

  // Listen for storage changes from other tabs/components
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === ONBOARD_STORAGE_KEY && e.newValue) {
        const step = parseInt(e.newValue, 10) as OnboardStep;
        if (step >= 1 && step <= 4) {
          setCurrentStep(step);
        }
      }
    };

    // Custom event listener for same-tab updates
    const handleCustomEvent = (e: CustomEvent<OnboardStep>) => {
      setCurrentStep(e.detail);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('onboard-step-change', handleCustomEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('onboard-step-change', handleCustomEvent as EventListener);
    };
  }, []);

  const updateStep = (step: OnboardStep) => {
    setCurrentStep(step);
    localStorage.setItem(ONBOARD_STORAGE_KEY, step.toString());

    // Dispatch custom event for same-tab components
    window.dispatchEvent(new CustomEvent('onboard-step-change', { detail: step }));

    // Also dispatch storage event for cross-tab communication
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ONBOARD_STORAGE_KEY,
        newValue: step.toString(),
      })
    );
  };

  const getCurrentDescription = () => STEP_DESCRIPTIONS[currentStep - 1];

  // const isCompleted = currentStep === 4;

  return {
    currentStep,
    updateStep,
    getCurrentDescription,
    // isCompleted,
    totalSteps: 4 as const,
  };
}

// Export utility function for components that don't use the hook
export const updateOnboardStep = (step: OnboardStep) => {
  if (step >= 1 && step <= 4) {
    localStorage.setItem(ONBOARD_STORAGE_KEY, step.toString());

    // Dispatch custom event for same-tab components
    window.dispatchEvent(new CustomEvent('onboard-step-change', { detail: step }));

    // Also dispatch storage event for cross-tab communication
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ONBOARD_STORAGE_KEY,
        newValue: step.toString(),
      })
    );
  }
};
