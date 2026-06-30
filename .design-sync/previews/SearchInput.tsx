import { SearchInput } from '@insforge/ui';

const noop = () => {};

export const Empty = () => (
  <div style={{ padding: 16, maxWidth: 320 }}>
    <SearchInput value="" onChange={noop} placeholder="Search tables..." />
  </div>
);

export const WithValue = () => (
  <div style={{ padding: 16, maxWidth: 320 }}>
    <SearchInput value="users" onChange={noop} placeholder="Search tables..." />
  </div>
);

export const FullWidth = () => (
  <div style={{ padding: 16 }}>
    <SearchInput value="" onChange={noop} placeholder="Search members by email or name" />
  </div>
);
