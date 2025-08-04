import { useState, useEffect } from 'react';

const ONBOARDING_COMPLETION_KEY = 'insforge_onboarding_completed';

export function useOnboardingCompletion() {
  const [isCompleted, setIsCompleted] = useState<boolean>(() => {
    const stored = localStorage.getItem(ONBOARDING_COMPLETION_KEY);
    return stored === 'true';
  });

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === ONBOARDING_COMPLETION_KEY && event.newValue) {
        setIsCompleted(event.newValue === 'true');
      }
    };

    // Only listen to storage events from other tabs/windows
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
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
