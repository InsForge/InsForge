import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  Button,
} from '@insforge/ui';
import { Info } from 'lucide-react';

// Tooltip is a Radix Root that needs TooltipProvider context. Rendered open so
// the portalled content shows. cfg.overrides.Tooltip pins single + viewport.
export const Default = () => (
  <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="secondary" size="icon-sm" aria-label="Info">
            <Info />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Anon keys are safe to expose client-side</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
);
