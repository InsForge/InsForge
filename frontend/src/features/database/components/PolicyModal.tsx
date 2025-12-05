import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components';
import { useTheme } from '@/lib/contexts/ThemeContext';

type PolicyField = 'using' | 'withCheck';

interface PolicyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  field: PolicyField;
  value: string;
}

export function PolicyModal({ open, onOpenChange, field, value }: PolicyModalProps) {
  const title = field === 'using' ? 'Using' : 'With Check';
  const { resolvedTheme } = useTheme();

  const customTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent' },
    '.cm-gutters': { display: 'none' },
    '.cm-content': { padding: '16px' },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground': { backgroundColor: 'transparent !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'transparent !important' },
    '.cm-cursor': { display: 'none' },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-zinc-950 dark:text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="mt-2 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-900 max-h-[400px] overflow-auto">
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

interface PolicyCellButtonProps {
  value: string | null;
  field: PolicyField;
  onOpenModal: (field: PolicyField, value: string) => void;
}

export function PolicyCellButton({ value, field, onOpenModal }: PolicyCellButtonProps) {
  if (!value) {
    return <span className="text-sm">-</span>;
  }

  return (
    <div className="flex items-center justify-between gap-1 min-w-0">
      <span className="text-sm truncate">{value}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenModal(field, value);
        }}
        className="shrink-0 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors"
      >
        <ExternalLink className="size-4 text-zinc-400 dark:text-neutral-400" />
      </button>
    </div>
  );
}

interface UsePolicyModalReturn {
  modalProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    field: PolicyField;
    value: string;
  };
  openModal: (field: PolicyField, value: string) => void;
}

export function usePolicyModal(): UsePolicyModalReturn {
  const [modalState, setModalState] = useState<{
    open: boolean;
    field: PolicyField;
    value: string;
  }>({
    open: false,
    field: 'using',
    value: '',
  });

  const openModal = (field: PolicyField, value: string) => {
    setModalState({ open: true, field, value });
  };

  const handleOpenChange = (open: boolean) => {
    setModalState((prev) => ({ ...prev, open }));
  };

  return {
    modalProps: {
      open: modalState.open,
      onOpenChange: handleOpenChange,
      field: modalState.field,
      value: modalState.value,
    },
    openModal,
  };
}
