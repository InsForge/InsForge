import { InputField } from '@insforge/ui';

// InputField is a labeled input with optional leading icon, trailing dropdown,
// helper tip, and error — all gated by show* flags (each defaults TRUE, so a
// bare field shows a search icon + chevron + tip badge). Realistic form fields
// turn the extras off and turn on only what they need.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
    {children}
  </div>
);

export const Default = () => (
  <Frame>
    <InputField
      label="Project name"
      placeholder="my-project"
      showIcon={false}
      showDropdown={false}
      showTip={false}
    />
  </Frame>
);

export const WithTip = () => (
  <Frame>
    <InputField
      label="Subdomain"
      defaultValue="insforge-prod"
      showIcon={false}
      showDropdown={false}
      tip="Used in your project's public URL"
      tipBadge="Optional"
    />
  </Frame>
);

export const SearchWithDropdown = () => (
  <Frame>
    <InputField label="Region" placeholder="Search regions" showTip={false} />
  </Frame>
);

export const ErrorState = () => (
  <Frame>
    <InputField
      label="Email"
      defaultValue="not-an-email"
      showIcon={false}
      showDropdown={false}
      showTip={false}
      error="Enter a valid email address"
    />
  </Frame>
);

export const Disabled = () => (
  <Frame>
    <InputField
      label="Project ID"
      defaultValue="prj_8f2a91"
      showIcon={false}
      showDropdown={false}
      showTip={false}
      disabled
    />
  </Frame>
);
