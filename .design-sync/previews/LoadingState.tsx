import { LoadingState } from '@insforge/ui';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, minWidth: 320 }}>{children}</div>
);

export const Default = () => (
  <Frame>
    <LoadingState />
  </Frame>
);

export const LoadingTable = () => (
  <Frame>
    <LoadingState message="Loading customers..." />
  </Frame>
);

export const SyncingData = () => (
  <Frame>
    <LoadingState message="Syncing project schema…" />
  </Frame>
);
