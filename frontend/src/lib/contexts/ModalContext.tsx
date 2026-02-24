import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type SettingsTab = 'info' | 'compute' | 'connect';

interface ModalContextType {
  isOnboardingModalOpen: boolean;
  setOnboardingModalOpen: (open: boolean) => void;
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
  const [isOnboardingModalOpen, setIsOnboardingModalOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<SettingsTab>('info');

  const setOnboardingModalOpen = useCallback((open: boolean) => {
    setIsOnboardingModalOpen(open);
  }, []);

  const openSettingsDialog = useCallback((tab: SettingsTab = 'info') => {
    setSettingsDefaultTab(tab);
    setIsSettingsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  const value: ModalContextType = {
    isOnboardingModalOpen,
    setOnboardingModalOpen,
    isSettingsDialogOpen,
    settingsDefaultTab,
    openSettingsDialog,
    closeSettingsDialog,
  };

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};
