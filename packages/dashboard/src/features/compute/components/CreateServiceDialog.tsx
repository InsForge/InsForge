import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { CPU_TIERS, MEMORY_OPTIONS, REGIONS } from '#features/compute/constants';
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
  const { t } = useTranslation('chrome');
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
    try {
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
    } catch {
      // Error is surfaced to the caller's onError handler (e.g. useComputeServices toast)
    }
  };

  const isValid = name.length > 0 && imageUrl.length > 0 && Number(port) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {t('compute.createService', { defaultValue: 'Create Service' })}
          </DialogTitle>
          <DialogDescription>
            {t('compute.createServiceDescription', {
              defaultValue: 'Deploy a Docker container as a compute service.',
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('compute.fields.name', { defaultValue: 'Name' })}
              </label>
              <Input placeholder="my-api" value={name} onChange={(e) => setName(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                {t('compute.nameHint', {
                  defaultValue: 'DNS-safe: lowercase, numbers, dashes',
                })}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                {t('compute.fields.imageUrl', { defaultValue: 'Image URL' })}
              </label>
              <Input
                placeholder="nginx:alpine"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t('compute.fields.port', { defaultValue: 'Port' })}
                </label>
                <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t('compute.fields.region', { defaultValue: 'Region' })}
                </label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {t(`compute.regions.${r.value}`, { defaultValue: r.label })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t('compute.fields.cpu', { defaultValue: 'CPU' })}
                </label>
                <Select value={cpu} onValueChange={setCpu}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CPU_TIERS.map((tier) => (
                      <SelectItem key={tier.value} value={tier.value}>
                        {tier.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">
                  {t('compute.fields.memory', { defaultValue: 'Memory' })}
                </label>
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
            {t('compute.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            variant="primary"
            size="lg"
            disabled={!isValid || isCreating}
            onClick={() => void handleSubmit()}
          >
            {isCreating
              ? t('compute.creating', { defaultValue: 'Creating...' })
              : t('compute.createService', { defaultValue: 'Create Service' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
