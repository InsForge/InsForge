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
import { CPU_TIERS, MEMORY_OPTIONS, REGIONS, INGRESS_MODES } from '#features/compute/constants';
import { useComputeCapabilities } from '#features/compute/hooks/useComputeCapabilities';
import type {
  CreateServiceRequest,
  CreateServiceRequestInput,
  IngressMode,
} from '@insforge/shared-schemas';

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (data: CreateServiceRequestInput) => Promise<unknown>;
  isCreating: boolean;
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  onCreate,
  isCreating,
}: CreateServiceDialogProps) {
  const { t } = useTranslation('chrome');
  const { capabilities } = useComputeCapabilities();
  const [name, setName] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('8080');
  const [cpu, setCpu] = useState('shared-1x');
  const [memory, setMemory] = useState('512');
  const [region, setRegion] = useState('iad');
  const [ingress, setIngress] = useState<IngressMode>('none');

  // Undefined capabilities means "not known yet": metadata still loading, compute
  // not configured, or a backend older than the slice. The two controls fall back
  // in opposite directions, and both are deliberate — what matters is which way is
  // right against a backend that predates this feature.
  //
  // Region falls back to *shown*, because a pre-capability backend is a Fly backend
  // and regions are real there; hiding it would remove a working control.
  //
  // Ingress falls back to *hidden*, because a pre-capability backend has no ingress
  // field at all — the schema would drop the key and the choice would silently do
  // nothing, which is the exact failure this gating exists to prevent.
  const showRegion = capabilities ? capabilities.regions : true;
  const offeredIngress = capabilities?.ingressModes ?? [];
  const showIngress = offeredIngress.length > 1;

  const resetForm = () => {
    setName('');
    setImageUrl('');
    setPort('8080');
    setCpu('shared-1x');
    setMemory('512');
    setRegion('iad');
    setIngress('none');
  };

  const handleSubmit = async () => {
    try {
      await onCreate({
        name,
        imageUrl,
        port: Number(port),
        cpu: cpu as CreateServiceRequest['cpu'],
        memory: Number(memory),
        // Omitted rather than sent as a default the provider would drop on the
        // floor: a single-host driver has one place to run, and recording a
        // region the user never chose makes the stored row a small lie.
        ...(showRegion ? { region } : {}),
        ...(showIngress ? { ingress } : {}),
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

              {showRegion && (
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
              )}

              {showIngress && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">
                    {t('compute.fields.ingress', { defaultValue: 'Reachable from' })}
                  </label>
                  <Select value={ingress} onValueChange={(v) => setIngress(v as IngressMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INGRESS_MODES.filter((m) => offeredIngress.includes(m.value)).map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {t(`compute.ingressModes.${m.value}`, { defaultValue: m.label })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
