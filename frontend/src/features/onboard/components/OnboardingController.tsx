import { useEffect, useCallback } from 'react';
import { useModal } from '@/lib/hooks/useModal';
import { parseCloudEvent } from '@/lib/utils/cloudMessaging';
import { isIframe } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { getOnboardingSkipped, setOnboardingSkipped } from './OnboardingModal';

/**
 * OnboardingController manages onboarding modal state:
 * - Handles Cloud parent messages in iframe mode
 * - Auto-opens onboarding for new users (non-iframe mode)
 * - Auto-closes onboarding when MCP connection is established (all modes)
 */
export function OnboardingController() {
  const { setOnboardingModalOpen } = useModal();
  const { hasCompletedOnboarding, isLoading: isMcpLoading } = useMcpUsage();

  // Handle messages from Cloud parent window (iframe mode only)
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      if (!isIframe()) {
        return;
      }

      const result = parseCloudEvent(event.data);
      if (!result.ok) {
        return;
      }

      const cloudEvent = result.data;

      switch (cloudEvent.type) {
        case 'SHOW_ONBOARDING_OVERLAY':
          setOnboardingModalOpen(true);
          break;
      }
    },
    [setOnboardingModalOpen]
  );

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [handleMessage]);

  // Auto-open onboarding modal for new users (non-iframe mode only)
  // In iframe mode, Cloud controls when to show the modal via messages
  useEffect(() => {
    if (isIframe()) {
      return;
    }
    if (!isMcpLoading && !hasCompletedOnboarding && !getOnboardingSkipped()) {
      setOnboardingModalOpen(true);
    }
  }, [isMcpLoading, hasCompletedOnboarding, setOnboardingModalOpen]);

  // Auto-close onboarding modal when MCP connection is established (all modes)
  useEffect(() => {
    if (!isMcpLoading && hasCompletedOnboarding) {
      setOnboardingModalOpen(false);
      setOnboardingSkipped(false);
    }
  }, [hasCompletedOnboarding, isMcpLoading, setOnboardingModalOpen]);

  return null;
}
