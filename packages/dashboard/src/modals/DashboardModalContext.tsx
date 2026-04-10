import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type DashboardSettingsTab = 'info' | 'compute' | 'connect';
const CONNECT_DIALOG_MESSAGE_TYPES = new Set(['SHOW_ONBOARDING_OVERLAY', 'SHOW_CONNECT_OVERLAY']);

interface DashboardModalContextValue {
  isConnectDialogOpen: boolean;
  setConnectDialogOpen: (open: boolean) => void;
  isSettingsDialogOpen: boolean;
  settingsDefaultTab: DashboardSettingsTab;
  openSettingsDialog: (tab?: DashboardSettingsTab) => void;
  closeSettingsDialog: () => void;
}

const DashboardModalContext = createContext<DashboardModalContextValue | undefined>(undefined);

export function useDashboardModal() {
  const context = useContext(DashboardModalContext);
  if (!context) {
    throw new Error('useDashboardModal must be used within a DashboardModalProvider');
  }
  return context;
}

interface DashboardModalProviderProps {
  children: ReactNode;
  connectDialogOpen?: boolean;
  onConnectDialogOpenChange?: (open: boolean) => void;
}

export function DashboardModalProvider({
  children,
  connectDialogOpen,
  onConnectDialogOpenChange,
}: DashboardModalProviderProps) {
  const [uncontrolledConnectDialogOpen, setUncontrolledConnectDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<DashboardSettingsTab>('info');
  const isConnectDialogControlled = connectDialogOpen !== undefined;
  const isConnectDialogOpen = isConnectDialogControlled
    ? connectDialogOpen
    : uncontrolledConnectDialogOpen;

  const setConnectDialogOpen = useCallback(
    (open: boolean) => {
      if (!isConnectDialogControlled) {
        setUncontrolledConnectDialogOpen(open);
      }
      onConnectDialogOpenChange?.(open);
    },
    [isConnectDialogControlled, onConnectDialogOpenChange]
  );

  useEffect(() => {
    const parentWindow = typeof window !== 'undefined' ? window.parent : null;
    const openerWindow = typeof window !== 'undefined' ? window.opener : null;
    const canReceiveHostMessages =
      parentWindow !== null && (parentWindow !== window || openerWindow !== null);

    if (!canReceiveHostMessages) {
      return;
    }

    const handleMessage = (event: MessageEvent<{ type?: string }>) => {
      const isParentMessage = event.source === parentWindow;
      const isOpenerMessage = openerWindow !== null && event.source === openerWindow;
      if (!isParentMessage && !isOpenerMessage) {
        return;
      }

      const messageType = event.data?.type;
      if (messageType && CONNECT_DIALOG_MESSAGE_TYPES.has(messageType)) {
        setConnectDialogOpen(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setConnectDialogOpen]);

  const openSettingsDialog = useCallback((tab: DashboardSettingsTab = 'info') => {
    setSettingsDefaultTab(tab);
    setIsSettingsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  return (
    <DashboardModalContext.Provider
      value={{
        isConnectDialogOpen,
        setConnectDialogOpen,
        isSettingsDialogOpen,
        settingsDefaultTab,
        openSettingsDialog,
        closeSettingsDialog,
      }}
    >
      {children}
    </DashboardModalContext.Provider>
  );
}
