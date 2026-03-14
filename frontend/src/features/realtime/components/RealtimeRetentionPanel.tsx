import { useEffect, useState } from 'react';
import { Button, Input, Switch } from '@insforge/ui';
import { useRealtimeMessageRetention } from '../hooks/useRealtimeMessageRetention';

export function RealtimeRetentionPanel() {
  const { config, isLoading, isUpdating, isRunningCleanup, updateConfig, runCleanup } =
    useRealtimeMessageRetention();

  const [enabled, setEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState('30');
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!config) {
      return;
    }

    setEnabled(config.enabled);
    setRetentionDays(String(config.retentionDays));
  }, [config]);

  const parsedRetentionDays = Number.parseInt(retentionDays, 10);
  const isRetentionValid = Number.isInteger(parsedRetentionDays) && parsedRetentionDays >= 1;
  const isDirty =
    !!config &&
    (enabled !== config.enabled ||
      parsedRetentionDays !== config.retentionDays ||
      !isRetentionValid);

  const handleSave = () => {
    if (!config || !isRetentionValid) {
      return;
    }

    updateConfig({
      enabled,
      retentionDays: parsedRetentionDays,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    if (!config) {
      return;
    }

    setEnabled(config.enabled);
    setRetentionDays(String(config.retentionDays));
    setIsEditing(false);
  };

  return (
    <div className="mx-auto flex w-4/5 max-w-[1024px] flex-col gap-3 rounded border border-[var(--alpha-8)] bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Realtime message retention</p>
        <p className="text-xs text-muted-foreground">
          {isLoading || !config
            ? 'Loading retention policy...'
            : `Messages older than ${config.retentionDays} day${config.retentionDays === 1 ? '' : 's'} are pruned automatically every 15 minutes in batches of ${config.cleanupBatchSize}.`}
        </p>
      </div>

      {config && (
        <div className="flex flex-col gap-3 rounded border border-[var(--alpha-8)] bg-[var(--alpha-2)] p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">Automatic cleanup</p>
              <p className="text-xs text-muted-foreground">
                Disabling retention keeps all historical realtime message rows.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!isEditing || isUpdating}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="realtime-retention-days" className="text-sm text-foreground">
              Retention period in days
            </label>
            <div className="flex items-center gap-3">
              <Input
                id="realtime-retention-days"
                type="number"
                min={1}
                step={1}
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                disabled={!isEditing || isUpdating}
                className="h-8 w-32"
              />
              <span className="text-xs text-muted-foreground">Minimum 1 day</span>
            </div>
            {!isRetentionValid && (
              <p className="text-xs text-[rgb(var(--destructive))]">
                Retention must be at least 1 day.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isEditing ? (
              <>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || !isRetentionValid || isUpdating}
                  className="h-8 rounded px-3 text-sm font-medium"
                >
                  {isUpdating ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancel}
                  disabled={isUpdating}
                  className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => setIsEditing(true)}
                className="h-8 rounded px-3 text-sm font-medium"
              >
                Edit retention
              </Button>
            )}

            <Button
              type="button"
              variant="secondary"
              onClick={() => runCleanup()}
              disabled={isRunningCleanup}
              className="h-8 rounded border-[var(--alpha-8)] bg-card px-3 text-sm font-medium"
            >
              {isRunningCleanup ? 'Running cleanup...' : 'Run cleanup now'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
