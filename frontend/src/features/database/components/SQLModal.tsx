import { ExternalLink } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components';
import { useTheme } from '@/lib/contexts/ThemeContext';

const customTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', maxHeight: '400px' },
  '.cm-scroller': { overflow: 'auto' },
  '.cm-gutters': { display: 'none' },
  '.cm-content': { padding: '16px' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground': { backgroundColor: 'transparent !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'transparent !important' },
  '.cm-cursor': { display: 'none' },
});

interface SQLModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  value: string;
}

export function SQLModal({ open, onOpenChange, title, value }: SQLModalProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-zinc-950 dark:text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-900">
          <CodeMirror
            value={value}
            theme={[resolvedTheme === 'dark' ? vscodeDark : vscodeLight, customTheme]}
            extensions={[sql(), EditorView.lineWrapping, EditorView.editable.of(false)]}
            editable={false}
            basicSetup={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SQLCellButtonProps {
  value: string | null;
  onClick: () => void;
}

export function SQLCellButton({ value, onClick }: SQLCellButtonProps) {
  if (!value) {
    return <span className="text-sm">-</span>;
  }

  return (
    <div className="flex items-center justify-between gap-1 min-w-0">
      <span className="text-sm truncate">{value}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="shrink-0 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
      >
        <ExternalLink className="size-4 text-zinc-400 dark:text-neutral-400" />
      </button>
    </div>
  );
}
