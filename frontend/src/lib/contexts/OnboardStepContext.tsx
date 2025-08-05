import React, { createContext, useContext, useState, useEffect } from 'react';

export type OnboardStep = 1 | 2 | 3 | 4;

interface OnboardContextValue {
  currentStep: OnboardStep;
  updateStep: (step: OnboardStep) => void;
  getCurrentDescription: () => string;
  totalSteps: 4;
}

const ONBOARD_STORAGE_KEY = 'insforge_onboard_step';
export const STEP_DESCRIPTIONS = [
  'Install Node.js',
  'Install InsForge',
  'Test the Connection',
  'Start Using InsForge',
] as const;

const OnboardContext = createContext<OnboardContextValue | null>(null);

export function OnboardStepProvider({ children }: { children: React.ReactNode }) {
  const [currentStep, setCurrentStep] = useState<OnboardStep>(() => {
    const saved = localStorage.getItem(ONBOARD_STORAGE_KEY);
    const n = saved ? parseInt(saved, 10) : NaN;
    return n >= 1 && n <= 4 ? (n as OnboardStep) : 1;
  });

  // Cross-tab updates
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ONBOARD_STORAGE_KEY && e.newValue) {
        const n = parseInt(e.newValue, 10) as OnboardStep;
        if (n >= 1 && n <= 4) {
          setCurrentStep(n);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const updateStep = (step: OnboardStep) => {
    if (step < 1 || step > 4) {
      return;
    }
    setCurrentStep(step);
    localStorage.setItem(ONBOARD_STORAGE_KEY, step.toString());
  };

  const getCurrentDescription = () => STEP_DESCRIPTIONS[currentStep - 1];

  return (
    <OnboardContext.Provider
      value={{ currentStep, updateStep, getCurrentDescription, totalSteps: 4 }}
    >
      {children}
    </OnboardContext.Provider>
  );
}

export function useOnboardStep() {
  const ctx = useContext(OnboardContext);
  if (!ctx) {
    throw new Error('useOnboardStep must be used within an OnboardProvider');
  }
  return ctx;
}
