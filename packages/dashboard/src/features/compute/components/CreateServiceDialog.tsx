import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@insforge/ui';
import { CPU_TIERS, MEMORY_OPTIONS, REGIONS } from '../constants';
import type { CreateServiceRequest } from '@insforge/shared-schemas';

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: CreateServiceRequest) => Promise<unknown>;
  isCreating: boolean;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: CreateServiceDialogProps) {
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('8080');
  const [cpu, setCpu] = useState('shared-1x');
  const [memory, setMemory] = useState('512');
  const [region, setRegion] = useState('iad');

  const resetForm = () => {
    setName('');
    setImageUrl('');
    setPort('8080');
    setCpu('shared-1x');
    setMemory('512');
    setRegion('iad');
  };

  const handleSubmit = async () => {
    await onCreate({
      name,
      imageUrl,
      port: Number(port),
      cpu: cpu as CreateServiceRequest['cpu'],
      memory: Number(memory),
      region,
    });
    resetForm();
    onOpenChange(false);
  };

  const isValid = name.length > 0 && imageUrl.length > 0 && Number(port) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Create Service</DialogTitle>
          <DialogDescription>Deploy a Docker container as a compute service.</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input placeholder="my-api" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">DNS-safe: lowercase, numbers, dashes</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Image URL</label>
              <Input
                placeholder="nginx:alpine"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Port</label>
                <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Region</label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">CPU</label>
                <Select value={cpu} onValueChange={setCpu}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CPU_TIERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Memory</label>
                <Select value={memory} onValueChange={setMemory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY_OPTIONS.map((m) => (
                      <SelectItem key={m} value={String(m)}>
                        {m} MB
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            variant="secondary"
            size="lg"
            disabled={isCreating}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!isValid || isCreating}
            onClick={() => void handleSubmit()}
          >
            {isCreating ? 'Creating...' : 'Create Service'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
