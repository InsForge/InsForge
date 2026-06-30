import { Switch } from '@insforge/ui';

const noop = () => {};

const Field = ({ children }: { children: React.ReactNode }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>{children}</label>
);

export const States = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
    <Field>
      <Switch checked onCheckedChange={noop} />
      Enable public access
    </Field>
    <Field>
      <Switch checked={false} onCheckedChange={noop} />
      Require email verification
    </Field>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: 16 }}>
    <Switch size="default" checked onCheckedChange={noop} />
    <Switch size="sm" checked onCheckedChange={noop} />
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
    <Field>
      <Switch checked disabled />
      <span style={{ opacity: 0.4 }}>Realtime (Pro plan)</span>
    </Field>
    <Field>
      <Switch checked={false} disabled />
      <span style={{ opacity: 0.4 }}>Point-in-time recovery</span>
    </Field>
  </div>
);
