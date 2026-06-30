import { Badge } from '@insforge/ui';

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 16 }}>
    {children}
  </div>
);

export const Variants = () => (
  <Row>
    <Badge variant="default">Production</Badge>
    <Badge variant="rounded">Active</Badge>
    <Badge variant="number">3</Badge>
  </Row>
);

export const StatusLabels = () => (
  <Row>
    <Badge variant="rounded">Deployed</Badge>
    <Badge variant="rounded">Building</Badge>
    <Badge variant="rounded">Queued</Badge>
    <Badge variant="default">PostgreSQL</Badge>
  </Row>
);

export const Counters = () => (
  <Row>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      Members
      <Badge variant="number">12</Badge>
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      Pending invites
      <Badge variant="number">2</Badge>
    </span>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      Errors
      <Badge variant="number">99</Badge>
    </span>
  </Row>
);
