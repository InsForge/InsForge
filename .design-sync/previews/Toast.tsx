import { Toast, Button } from '@insforge/ui';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

// Toast is an inline notification bar (not a portal). It can stretch wide
// (max-w 800px), so cfg.overrides.Toast uses column mode (one per row).
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
);

export const Success = () => (
  <Frame>
    <Toast icon={<CheckCircle2 className="size-5 text-[rgb(var(--success))]" />}>
      Deployment finished — your function is live.
    </Toast>
  </Frame>
);

export const WithAction = () => (
  <Frame>
    <Toast
      icon={<AlertTriangle className="size-5 text-[rgb(var(--warning))]" />}
      action={
        <Button variant="ghost" size="sm">
          Undo
        </Button>
      }
    >
      Row deleted from “users”.
    </Toast>
  </Frame>
);

export const Plain = () => (
  <Frame>
    <Toast>Saved changes to your project settings.</Toast>
  </Frame>
);
