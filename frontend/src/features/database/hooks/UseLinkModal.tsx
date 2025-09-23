import { createContext, useContext, useState, ReactNode } from 'react';
import type { DatabaseRecord } from '@/components/datagrid';

interface LinkModalState {
  isOpen: boolean;
  referenceTable: string | null;
  referenceColumn: string | null;
  currentValue: string | null;
  onSelectRecord: ((record: DatabaseRecord) => void) | null;
}

interface LinkModalContextType {
  modalState: LinkModalState;
  openModal: (config: {
    referenceTable: string;
    referenceColumn: string;
    currentValue?: string | null;
    onSelectRecord: (record: DatabaseRecord) => void;
  }) => void;
  closeModal: () => void;
}

const LinkModalContext = createContext<LinkModalContextType | undefined>(undefined);

const initialState: LinkModalState = {
  isOpen: false,
  referenceTable: null,
  referenceColumn: null,
  currentValue: null,
  onSelectRecord: null,
};

interface LinkModalProviderProps {
  children: ReactNode;
}

export function LinkModalProvider({ children }: LinkModalProviderProps) {
  const [modalState, setModalState] = useState<LinkModalState>(initialState);

  const openModal = (config: {
    referenceTable: string;
    referenceColumn: string;
    currentValue?: string | null;
    onSelectRecord: (record: DatabaseRecord) => void;
  }) => {
    setModalState({
      isOpen: true,
      referenceTable: config.referenceTable,
      referenceColumn: config.referenceColumn,
      currentValue: config.currentValue || null,
      onSelectRecord: config.onSelectRecord,
    });
  };

  const closeModal = () => {
    setModalState(initialState);
  };

  return (
    <LinkModalContext.Provider
      value={{
        modalState,
        openModal,
        closeModal,
      }}
    >
      {children}
    </LinkModalContext.Provider>
  );
}

export function useLinkModal() {
  const context = useContext(LinkModalContext);
  if (context === undefined) {
    throw new Error('useLinkModal must be used within a LinkModalProvider');
  }
  return context;
}
