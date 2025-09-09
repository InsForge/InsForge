import React, { useEffect, useState } from 'react';
import { FileJson, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/radix/Button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/radix/Popover';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CellEditorProps } from '.';
import { formatValueForDisplay, cn } from '@/lib/utils/utils';
import { ColumnType } from '@insforge/shared-schemas';
import { ColumnValueType } from '@/components/datagrid/datagridTypes';

export function JsonCellEditor({
  value,
  nullable,
  onValueChange,
  onCancel,
  className,
}: CellEditorProps<ColumnValueType<ColumnType.JSON> | null>) {
  const [open, setOpen] = useState(true);
  const [showNullConfirm, setShowNullConfirm] = useState(false);
  const [jsonText, setJsonText] = useState(() => {
    if (!value || value === 'null') {
      return '';
    }
    return formatValueForDisplay(value, ColumnType.JSON);
  });
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-open the popover when component mounts
    setOpen(true);
  }, []);

  const validateJson = (text: string) => {
    // Ensure text is a string before calling trim
    const textStr = String(text || '');
    if (textStr.trim() === '') {
      setIsValid(true);
      setError(null);
      return true;
    }

    try {
      JSON.parse(textStr);
      setIsValid(true);
      setError(null);
      return true;
    } catch (e) {
      setIsValid(false);
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      return false;
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setJsonText(newText);
    validateJson(newText);
  };

  const handleFormat = () => {
    // Ensure jsonText is a string before calling trim
    const textStr = String(jsonText || '');
    if (textStr.trim() === '') {
      return;
    }

    try {
      const parsed = JSON.parse(textStr);
      setJsonText(JSON.stringify(parsed, null, 2));
      setIsValid(true);
      setError(null);
    } catch (e) {
      console.error(e);
      // Already showing error from validation
    }
  };

  const handleMinify = () => {
    // Ensure jsonText is a string before calling trim
    const textStr = String(jsonText || '');
    if (textStr.trim() === '') {
      return;
    }

    try {
      const parsed = JSON.parse(textStr);
      setJsonText(JSON.stringify(parsed));
      setIsValid(true);
      setError(null);
    } catch (e) {
      console.error(e);
      // Already showing error from validation
    }
  };

  const handleSave = () => {
    if (!isValid) {
      return;
    }

    // Ensure jsonText is a string before calling trim
    const textStr = String(jsonText || '');
    if (textStr.trim() === '') {
      onValueChange(nullable ? 'null' : '{}');
    } else {
      try {
        // Validate and normalize the JSON before saving
        const parsed = JSON.parse(textStr);
        onValueChange(JSON.stringify(parsed));
      } catch {
        // This shouldn't happen as we validate before enabling save
        return;
      }
    }
    setOpen(false);
  };

  const handleSetNull = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!nullable) {
      return;
    }

    // Check if there's existing data
    const textStr = String(jsonText || '');
    const hasData = textStr.trim() !== '' && textStr !== 'null';

    if (hasData) {
      // Show confirmation dialog if there's existing data
      setShowNullConfirm(true);
    } else {
      // Directly set to null if no data
      confirmSetNull();
    }
  };

  const confirmSetNull = () => {
    setShowNullConfirm(false);
    onValueChange('null');
    setOpen(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !showNullConfirm) {
      // Only cancel if confirmation dialog is not showing
      onCancel();
    }
    setOpen(isOpen);
  };

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return 'Empty JSON';
    }

    return formatValueForDisplay(value, ColumnType.JSON);
  };

  return (
    <>
      <Popover open={open} onOpenChange={showNullConfirm ? undefined : handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              'w-full justify-start text-sm text-left font-normal h-full border-0 p-0 hover:bg-transparent dark:text-white',
              (!value || value === 'null') && 'text-muted-foreground',
              className
            )}
          >
            <FileJson className="mr-2 h-4 w-4" />
            <span className="truncate">{formatDisplayValue()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="overflow-hidden w-125 p-0 dark:bg-neutral-800 dark:border-neutral-700"
          align="start"
          side="bottom"
        >
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">JSON Editor</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFormat}
                  disabled={!isValid || String(jsonText || '').trim() === ''}
                  className="h-7 px-2"
                >
                  Format
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMinify}
                  disabled={!isValid || String(jsonText || '').trim() === ''}
                  className="h-7 px-2"
                >
                  Minify
                </Button>
              </div>
            </div>

            <div className="relative">
              <textarea
                value={jsonText}
                onChange={handleTextChange}
                onKeyDown={(e) => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const target = e.target as HTMLTextAreaElement;
                    const start = target.selectionStart;
                    const end = target.selectionEnd;

                    // Insert 2 spaces at cursor position
                    const newValue = jsonText.substring(0, start) + '  ' + jsonText.substring(end);
                    setJsonText(newValue);
                    validateJson(newValue);

                    // Move cursor after the inserted spaces
                    setTimeout(() => {
                      target.selectionStart = target.selectionEnd = start + 2;
                    }, 0);
                  } else if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    handleSave();
                  } else if (e.key === 'Enter') {
                    // Allow Enter to create new lines (prevent it from bubbling up to parent components)
                    e.stopPropagation();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                    setOpen(false);
                  }
                }}
                placeholder="Enter JSON here..."
                className={cn(
                  'w-full h-75 px-3 py-2 text-sm border border-border-gray dark:border-neutral-600 rounded-md font-mono resize-none',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2',
                  isValid ? 'focus:ring-primary' : 'focus:ring-red-500 border-red-500'
                )}
                spellCheck={false}
                autoFocus
              />

              {/* Validation indicator */}
              <div
                className={cn(
                  'absolute bottom-2 right-2 flex items-center gap-1',
                  isValid ? 'text-green-600' : 'text-red-600'
                )}
              >
                {isValid ? (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    <span className="text-xs">Valid JSON</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-xs">Invalid JSON</span>
                  </>
                )}
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>
            )}

            {/* Tips */}
            <div className="mt-2 text-xs text-muted-foreground">
              Tip: Use Tab for indentation, Ctrl+Enter to save, Escape to cancel
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 p-3 border-t border-border-gray dark:border-neutral-600 bg-muted/30 dark:bg-neutral-800">
            {nullable && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSetNull}
                className="flex-1 dark:bg-neutral-600 dark:text-white dark:hover:bg-neutral-700"
              >
                Null
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onCancel();
                setOpen(false);
              }}
              className="flex-1 dark:bg-neutral-600 dark:text-white dark:hover:bg-neutral-700"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!isValid} className="flex-1">
              Save
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <ConfirmDialog
        open={showNullConfirm}
        onOpenChange={setShowNullConfirm}
        title="Clear JSON Data"
        description="This action will permanently remove the current JSON data from this cell and set it to null. Are you sure you want to continue?"
        confirmText="Clear Data"
        cancelText="Cancel"
        onConfirm={confirmSetNull}
        destructive={true}
      />
    </>
  );
}
