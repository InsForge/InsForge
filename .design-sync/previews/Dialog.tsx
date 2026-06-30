import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogMessage,
  Button,
  Input,
} from '@insforge/ui';

// Dialog is an overlay (Radix portal + fixed-center content). Rendered open so
// the composed surface shows in the card. cfg.overrides.Dialog pins single +
// a viewport so it doesn't escape the grid cell.
export const Default = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite teammate</DialogTitle>
        <DialogDescription>
          Send an invite to collaborate on this project. They'll get access right away.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <Input type="email" placeholder="teammate@company.com" />
      </DialogBody>
      <DialogFooter>
        <DialogMessage>An invite email will be sent.</DialogMessage>
        <Button variant="secondary" size="lg">
          Cancel
        </Button>
        <Button size="lg">Send invite</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
