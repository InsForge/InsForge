import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Skeleton, ConfirmDialog } from '@/components';
import { EnvVarRow } from '../components/EnvVarRow';
import { EnvVarDialog } from '../components/EnvVarDialog';
import EnvVarsEmptyState from '../components/EnvVarsEmptyState';
import { useDeploymentEnvVars } from '../hooks/useDeploymentEnvVars';
import type { DeploymentEnvVar } from '@insforge/shared-schemas';

export default function DeploymentEnvVarsPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingEnvVar, setEditingEnvVar] = useState<DeploymentEnvVar | null>(null);

  const { envVars, isLoading, isUpserting, upsertEnvVar, deleteEnvVar, confirmDialogProps } =
    useDeploymentEnvVars();

  const handleEdit = (envVar: DeploymentEnvVar) => {
    setEditingEnvVar(envVar);
  };

  const handleDelete = (envVar: DeploymentEnvVar) => {
    void deleteEnvVar(envVar);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex flex-col gap-6 p-4">
        {/* Header with Add Button */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-zinc-950 dark:text-white tracking-[-0.1px]">
            Environment Variables
          </h1>
          <Button
            onClick={() => setIsAddDialogOpen(true)}
            className="h-8 px-2 py-0 gap-2 bg-black text-white dark:bg-neutral-600 dark:text-white hover:bg-gray-800 dark:hover:bg-neutral-500 text-sm font-medium rounded"
          >
            <Plus className="w-4 h-4" />
            Add
          </Button>
        </div>

        {/* Table Header */}
        <div className="grid grid-cols-12 px-3 text-sm text-muted-foreground dark:text-neutral-400">
          <div className="col-span-4 py-1 px-3">Key</div>
          <div className="col-span-4 py-1 px-3">Value</div>
          <div className="col-span-3 py-1 px-3">Updated at</div>
          <div className="col-span-1 py-1 px-3" />
        </div>
      </div>

      {/* Scrollable Table Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-2">
          {isLoading ? (
            <>
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-lg" />
              ))}
            </>
          ) : envVars.length >= 1 ? (
            <>
              {envVars.map((envVar) => (
                <EnvVarRow
                  key={envVar.id}
                  envVar={envVar}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </>
          ) : (
            <EnvVarsEmptyState />
          )}
        </div>
      </div>

      {/* Add Dialog */}
      <EnvVarDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        onSave={upsertEnvVar}
        isSaving={isUpserting}
      />

      {/* Edit Dialog */}
      <EnvVarDialog
        open={!!editingEnvVar}
        onOpenChange={(open) => !open && setEditingEnvVar(null)}
        envVar={editingEnvVar}
        onSave={upsertEnvVar}
        isSaving={isUpserting}
      />

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
