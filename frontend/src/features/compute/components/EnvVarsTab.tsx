import { useState, useEffect } from 'react';
import { Button, Input } from '@insforge/ui';
import { Plus, Trash2 } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
}

interface EnvVarsTabProps {
  customVars?: EnvVar[];
  onSave: (vars: EnvVar[]) => void;
  onSaveAndRedeploy: (vars: EnvVar[]) => void;
  isSaving: boolean;
}

export function EnvVarsTab({
  customVars = [],
  onSave,
  onSaveAndRedeploy,
  isSaving,
}: EnvVarsTabProps) {
  const [vars, setVars] = useState<EnvVar[]>(customVars);

  useEffect(() => {
    setVars(customVars);
  }, [customVars]);

  const addVar = () => setVars((prev) => [...prev, { key: '', value: '' }]);

  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: val } : v)));
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index));
  };

  const validVars = vars.filter((v) => v.key.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Environment variables are encrypted at rest and injected at deploy time.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={addVar}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add
        </Button>
      </div>

      {vars.length === 0 && (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No environment variables configured.
        </p>
      )}

      <div className="space-y-2">
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
              className="flex-1 font-mono text-sm"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeVar(idx)}
              className="shrink-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {vars.length > 0 && (
        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onSave(validVars)} disabled={isSaving}>
            Save
          </Button>
          <Button size="sm" onClick={() => onSaveAndRedeploy(validVars)} disabled={isSaving}>
            Save & Redeploy
          </Button>
        </div>
      )}
    </div>
  );
}
