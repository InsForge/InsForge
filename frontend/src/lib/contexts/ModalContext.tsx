import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface ModalContextType {
  isOnboardingModalOpen: boolean;
  setOnboardingModalOpen: (open: boolean) => void;
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

  const setOnboardingModalOpen = useCallback((open: boolean) => {
    setIsOnboardingModalOpen(open);
  }, []);

  const value: ModalContextType = {
    isOnboardingModalOpen,
    setOnboardingModalOpen,
  };

  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
};
