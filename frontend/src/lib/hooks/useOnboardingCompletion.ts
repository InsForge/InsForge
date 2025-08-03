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

    const handleCustomEvent = (event: CustomEvent) => {
      if (typeof event.detail === 'boolean') {
        setIsCompleted(event.detail);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('onboarding-completion-change', handleCustomEvent as EventListener);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(
        'onboarding-completion-change',
        handleCustomEvent as EventListener
      );
    };
  }, []);

  const markAsCompleted = () => {
    setIsCompleted(true);
    localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'true');

    // Dispatch custom event for same-tab components
    window.dispatchEvent(new CustomEvent('onboarding-completion-change', { detail: true }));
  };

  const resetCompletion = () => {
    setIsCompleted(false);
    localStorage.setItem(ONBOARDING_COMPLETION_KEY, 'false');

    // Dispatch custom event for same-tab components
    window.dispatchEvent(new CustomEvent('onboarding-completion-change', { detail: false }));
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

  // Dispatch custom event for same-tab components
  window.dispatchEvent(new CustomEvent('onboarding-completion-change', { detail: true }));
};
