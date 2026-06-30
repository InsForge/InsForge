import { EmptyState } from '@insforge/ui';
import { FolderOpen, Search } from 'lucide-react';

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 32, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </div>
);

export const WithAction = () => (
  <Frame>
    <EmptyState
      icon={FolderOpen}
      title="No tables yet"
      description="Create your first table to start storing and querying data in your project."
      action={{ label: 'Create table', onClick: () => {} }}
    />
  </Frame>
);

export const NoResults = () => (
  <Frame>
    <EmptyState
      icon={Search}
      title="No results found"
      description="We couldn't find anything matching your search. Try a different keyword."
    />
  </Frame>
);

export const TitleOnly = () => (
  <Frame>
    <EmptyState title="This folder is empty" />
  </Frame>
);
