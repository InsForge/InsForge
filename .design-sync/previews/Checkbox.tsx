import { Checkbox } from '@insforge/ui';

const noop = () => {};

const Field = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>{children}</label>
);

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
    <Field>
      <Checkbox checked={false} onCheckedChange={noop} />
      Enable row-level security
    </Field>
    <Field>
      <Checkbox checked onCheckedChange={noop} />
      Send deployment notifications
    </Field>
    <Field>
      <Checkbox checked="indeterminate" onCheckedChange={noop} />
      Select all tables
    </Field>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 16 }}>
    <Field>
      <Checkbox checked={false} disabled />
      <span style={{ opacity: 0.4 }}>Auto-scale compute</span>
    </Field>
    <Field>
      <Checkbox checked disabled />
      <span style={{ opacity: 0.4 }}>Daily backups (managed)</span>
    </Field>
  </div>
);

export const SelectionList = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
    <Field>
      <Checkbox checked onCheckedChange={noop} />
      users
    </Field>
    <Field>
      <Checkbox checked onCheckedChange={noop} />
      projects
    </Field>
    <Field>
      <Checkbox checked={false} onCheckedChange={noop} />
      audit_logs
    </Field>
  </div>
);
