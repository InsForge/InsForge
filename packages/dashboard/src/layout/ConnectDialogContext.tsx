import { createContext, useContext } from 'react';

const ConnectDialogContext = createContext<(() => void) | undefined>(undefined);

export const ConnectDialogProvider = ConnectDialogContext.Provider;

export function useOpenConnectDialog() {
  const context = useContext(ConnectDialogContext);
  if (!context) {
    throw new Error('useOpenConnectDialog must be used within an AppLayout');
  }
  return context;
}
