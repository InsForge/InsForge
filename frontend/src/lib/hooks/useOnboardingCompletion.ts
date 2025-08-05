import { useMemo } from 'react';

const ONBOARDING_COMPLETION_KEY = 'insforge_onboarding_completed';

export function useOnboardingCompletion() {
  const isCompleted = useMemo<boolean>(() => {
    const stored = localStorage.getItem(ONBOARDING_COMPLETION_KEY);
    return stored === 'true';
  }, []);

  const markAsCompleted = () => {
    localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true');
  };

  const resetCompletion = () => {
    localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'false');
  };

  return {
    isCompleted,
    markAsCompleted,
    resetCompletion,
  };
}

// Export utility function for direct usage
export const markOnboardingAsCompleted = () => {
  localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true');
};
