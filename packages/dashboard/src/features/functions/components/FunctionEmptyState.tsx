import { Code2 } from 'lucide-react';

export default function FunctionEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <Code2 size={40} className="text-muted-foreground" />
      <div className="flex flex-col items-center justify-center gap-1">
        <p className="text-sm font-medium text-foreground">No functions available</p>
        <p className="text-muted-foreground text-xs">No edge functions have been created yet</p>
      </div>
    </div>
  );
}
