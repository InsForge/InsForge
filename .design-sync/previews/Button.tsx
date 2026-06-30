import { Button } from '@insforge/ui';
import { Plus, Trash2, Download } from 'lucide-react';

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: 16 }}>
    {children}
  </div>
);

export const Variants = () => (
  <Row>
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="outline">Outline</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="destructive">Delete</Button>
  </Row>
);

export const Sizes = () => (
  <Row>
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
  </Row>
);

export const WithIcons = () => (
  <Row>
    <Button>
      <Plus />
      New project
    </Button>
    <Button variant="secondary">
      <Download />
      Export
    </Button>
    <Button variant="destructive" size="icon" aria-label="Delete">
      <Trash2 />
    </Button>
  </Row>
);

export const Disabled = () => (
  <Row>
    <Button disabled>Primary</Button>
    <Button variant="secondary" disabled>
      Secondary
    </Button>
  </Row>
);
