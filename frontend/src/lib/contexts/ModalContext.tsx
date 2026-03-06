import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type SettingsTab = 'info' | 'compute' | 'connect';

interface ModalContextType {
  isConnectDialogOpen: boolean;
  setConnectDialogOpen: (open: boolean) => void;
  isSettingsDialogOpen: boolean;
  settingsDefaultTab: SettingsTab;
  openSettingsDialog: (tab?: SettingsTab) => void;
  closeSettingsDialog: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

interface ModalProviderProps {
  children: ReactNode;
}

export const ModalProvider: React.FC<ModalProviderProps> = ({ children }) => {
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('info');

  const setConnectDialogOpen = useCallback((open: boolean) => {
    setIsConnectDialogOpen(open);
  }, []);

  const openSettingsDialog = useCallback((tab: SettingsTab = 'info') => {
    setSettingsDefaultTab(tab);
    setIsSettingsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  const value: ModalContextType = {
    isConnectDialogOpen,
    setConnectDialogOpen,
    isSettingsDialogOpen,
    settingsDefaultTab,
    openSettingsDialog,
    closeSettingsDialog,
  };

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};
