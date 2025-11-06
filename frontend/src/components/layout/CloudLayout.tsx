import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/lib/contexts/ThemeContext';
import { cn } from '@/lib/utils/utils';
import { useMcpUsage } from '@/features/logs/hooks/useMcpUsage';
import { postMessageToParent } from '@/lib/utils/cloudMessaging';

interface CloudLayoutProps {
  children: React.ReactNode;
}

interface RouterMessage {
  type: 'ROUTE_CHANGE' | 'REFRESH';
  path: string;
}

export default function CloudLayout({ children }: CloudLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasCompletedOnboarding } = useMcpUsage();

  useEffect(() => {
    const handleCloudMessage = (event: MessageEvent) => {
      try {
        const message = event.data as RouterMessage;

        if (message.type === 'ROUTE_CHANGE' && message.path) {
          // Check if navigating to dashboard and onboarding not completed
          if (message.path === '/cloud/dashboard' && !hasCompletedOnboarding) {
            // Redirect to onboarding page
            void navigate('/cloud/onboard', { replace: true });
            return;
          }
          // Navigate to the corresponding cloud route
          void navigate(message.path);
        } else if (message.type === 'REFRESH') {
          window.location.reload();
        }
      } catch (error) {
        console.error('Error handling router message:', error);
      }
    };

    // Add event listener for messages from parent window
    window.addEventListener('message', handleCloudMessage);

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener('message', handleCloudMessage);
    };
  }, [navigate, hasCompletedOnboarding]);

  useEffect(() => {
    // Send the current route to the parent cloud application
    postMessageToParent(
      {
        type: 'APP_ROUTE_CHANGE',
        path: location.pathname,
      },
      '*'
    );
  }, [location.pathname]);

  return (
    <ThemeProvider forcedTheme="dark">
      <div
        className={cn(
          'h-screen bg-neutral-800',
          location.pathname !== '/cloud/visualizer' && 'pt-13 pl-13'
        )}
      >
        {children}
      </div>
    </ThemeProvider>
  );
}
