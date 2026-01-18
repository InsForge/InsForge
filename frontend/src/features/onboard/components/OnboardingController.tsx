import { useEffect, useCallback, useRef } from 'react';
import { useModal } from '@/lib/hooks/useModal';
import { parseCloudEvent } from '@/lib/utils/cloudMessaging';
import { isIframe } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { useSocket, ServerEvents } from '@/lib/contexts/SocketContext';
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
  const { socket } = useSocket();
  const hasHandledInitialState = useRef(false);

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
  // This handles the initial load case (hasCompletedOnboarding changes from false to true)
  useEffect(() => {
    if (!isMcpLoading && hasCompletedOnboarding && !hasHandledInitialState.current) {
      hasHandledInitialState.current = true;
      setOnboardingModalOpen(false);
      setOnboardingSkipped(false);
    }
  }, [hasCompletedOnboarding, isMcpLoading, setOnboardingModalOpen]);

  // Auto-close onboarding modal when a new MCP connection is established in real-time
  // This handles the case where user already has MCP records but opens modal again
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleMcpConnected = () => {
      setOnboardingModalOpen(false);
      setOnboardingSkipped(false);
    };

    socket.on(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    return () => {
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpConnected);
    };
  }, [socket, setOnboardingModalOpen]);

  return null;
}
