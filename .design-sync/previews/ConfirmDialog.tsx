import { ConfirmDialog } from '@insforge/ui';

// Overlay (renders open). cfg.overrides.ConfirmDialog pins single + viewport.
export const Destructive = () => (
  <ConfirmDialog
    open
    onOpenChange={() => {}}
    destructive
    title="Delete table"
    description="This permanently deletes the “users” table and all of its rows. This action cannot be undone."
    confirmText="Delete table"
    cancelText="Cancel"
    onConfirm={() => {}}
  />
);
