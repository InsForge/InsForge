import { useEffect, useCallback } from 'react';
import { useModal } from '../lib/contexts/ModalContext';
import { parseCloudEvent } from '@/lib/utils/cloudMessaging';
import { isIframe } from '@/lib/utils/utils';

/**
 * CloudMessageHandler handles messages from Cloud parent window when running in iframe mode.
 * This component should be rendered within ModalProvider.
 */
export function CloudMessageHandler() {
  const { setOnboardingModalOpen } = useModal();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Only process messages when running in an iframe
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

  // This component doesn't render anything - it only handles messages
  return null;
}
