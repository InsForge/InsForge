import { Input } from '@insforge/ui';

// Plain unstyled-chrome text input — the raw control InputField/SearchInput wrap.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
    {children}
  </div>
);

export const Default = () => (
  <Frame>
    <Input placeholder="teammate@company.com" />
  </Frame>
);

export const WithValue = () => (
  <Frame>
    <Input defaultValue="insforge-prod" />
  </Frame>
);

export const Disabled = () => (
  <Frame>
    <Input defaultValue="prj_8f2a91" disabled />
  </Frame>
);
