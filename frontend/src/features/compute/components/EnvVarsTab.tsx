import { useState } from 'react';
import { Button, Input } from '@insforge/ui';
import { Plus, Trash2, Lock } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
}

interface EnvVarsTabProps {
  customVars?: EnvVar[];
  onSave: (vars: EnvVar[]) => void;
  onSaveAndRedeploy: (vars: EnvVar[]) => void;
  isSaving?: boolean;
}

const AUTO_INJECTED_VARS = [
  { key: 'INSFORGE_DB_URL', description: 'PostgreSQL connection string' },
  { key: 'INSFORGE_BASE_URL', description: 'API base URL' },
  { key: 'INSFORGE_ANON_KEY', description: 'Anonymous API key' },
  { key: 'PORT', description: 'Container port (from config)' },
];

export function EnvVarsTab({
  customVars = [],
  onSave,
  onSaveAndRedeploy,
  isSaving,
}: EnvVarsTabProps) {
  const [vars, setVars] = useState<EnvVar[]>(customVars);

  const addVar = () => {
    setVars((prev) => [...prev, { key: '', value: '' }]);
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index));
  };

  const updateVar = (index: number, field: 'key' | 'value', value: string) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  return (
    <div className="flex flex-col gap-6 pt-2">
      {/* Auto-injected vars (read-only) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Auto-injected variables</h3>
        </div>
        <div className="flex flex-col gap-1 rounded border border-[var(--alpha-8)] overflow-hidden">
          {AUTO_INJECTED_VARS.map(({ key, description }) => (
            <div
              key={key}
              className="flex items-center gap-3 px-3 py-2 bg-[var(--alpha-4)] border-b border-[var(--alpha-8)] last:border-b-0"
            >
              <span className="text-sm font-mono text-foreground w-48 shrink-0">{key}</span>
              <span className="text-xs text-muted-foreground">{description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom vars */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Custom variables</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVar}
            className="h-7 px-2 gap-1 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </Button>
        </div>

        {vars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 border border-dashed border-[var(--alpha-8)] rounded text-center">
            <p className="text-sm text-muted-foreground">No custom variables.</p>
            <button
              type="button"
              onClick={addVar}
              className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Add one
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {vars.map((v, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  value={v.key}
                  onChange={(e) => updateVar(idx, 'key', e.target.value)}
                  placeholder="KEY"
                  className="flex-1 font-mono text-sm"
                />
                <Input
                  value={v.value}
                  onChange={(e) => updateVar(idx, 'value', e.target.value)}
                  placeholder="value"
                  className="flex-[2] font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeVar(idx)}
                  className="flex items-center justify-center w-8 h-8 rounded text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" disabled={isSaving} onClick={() => onSave(vars)}>
          Save
        </Button>
        <Button disabled={isSaving} onClick={() => onSaveAndRedeploy(vars)}>
          {isSaving ? 'Saving...' : 'Save & Redeploy'}
        </Button>
      </div>
    </div>
  );
}
