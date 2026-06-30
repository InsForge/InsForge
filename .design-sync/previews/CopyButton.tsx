import { CopyButton } from '@insforge/ui';

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, flexWrap: 'wrap' }}>
    {children}
  </div>
);

// The "copied" state is only reachable through a real click (3s timer in the
// component), so it can't be rendered statically. These cells show the default
// (idle) states the component exposes.

export const WithText = () => (
  <Row>
    <CopyButton text="ins_pk_live_8f2c1d4e9b7a3056c1d8e4f60a92b3c7d5e8f1a2" />
  </Row>
);

export const IconOnly = () => (
  <Row>
    <CopyButton text="https://api.insforge.dev/v1/projects/238181" showText={false} />
  </Row>
);

export const CustomLabel = () => (
  <Row>
    <CopyButton text="https://api.insforge.dev/v1/projects/238181" copyText="Copy URL" />
  </Row>
);
