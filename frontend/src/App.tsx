import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/lib/contexts/AuthContext';
import { ModalProvider } from '@/lib/contexts/ModalContext';
import { CloudMessageHandler } from '@/components/CloudMessageHandler';
import { AppRoutes } from '@/lib/routing/AppRoutes';
import { ToastProvider } from '@/lib/hooks/useToast';
import { SocketProvider } from '@/lib/contexts/SocketContext';
import { PostHogAnalyticsProvider } from './lib/analytics/posthog';
import { SQLEditorProvider } from '@/features/database/contexts/SQLEditorContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SocketProvider>
          <ToastProvider>
            <PostHogAnalyticsProvider>
              <ModalProvider>
                <CloudMessageHandler />
                <SQLEditorProvider>
                  <AppRoutes />
                </SQLEditorProvider>
              </ModalProvider>
            </PostHogAnalyticsProvider>
          </ToastProvider>
        </SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
