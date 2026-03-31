import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export type DashboardSettingsTab = 'info' | 'compute' | 'connect';

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
