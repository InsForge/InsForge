import { CopyButton } from '@insforge/ui';

function IdCell({ value }: { value: string }) {
  return (
    <div className="w-full h-full flex items-center justify-between group">
      <span className="text-sm truncate" title={String(value)}>
        {value}
      </span>
      <CopyButton
        text={String(value)}
        showText={false}
        className="h-7 w-7 min-w-7 shrink-0 rounded p-0 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}

export default IdCell;
