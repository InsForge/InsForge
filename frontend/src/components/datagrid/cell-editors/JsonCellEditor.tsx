import { useEffect, useState } from 'react';
import { FileJson, AlertCircle, CheckCircle } from 'lucide-react';
import { Badge, Button, ConfirmDialog } from '@insforge/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@/components';
import { cn } from '@/lib/utils/utils';
import type { JsonCellEditorProps } from './types';

export function JsonCellEditor({
  value,
  nullable,
  onValueChange,
  onCancel,
  className,
}: JsonCellEditorProps) {
  const [open, setOpen] = useState(true);
  const [showNullConfirm, setShowNullConfirm] = useState(false);
  const [jsonText, setJsonText] = useState(() => {
    // Ensure value is always converted to string
    if (!value || value === 'null') {
      return '';
    }

    // If value is already a string, try to parse and format it
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return value;
      }
    }

    // If value is an object/array, stringify it
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return JSON.stringify(value);
      }
    }

    // For any other type, convert to string
    return String(value || '');
  });
  const [isValid, setIsValid] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasJsonText = String(jsonText || '').trim() !== '';

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
    } catch (error) {
      console.error(error);
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
    } catch (error) {
      console.error(error);
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

    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;

      if (typeof parsed !== 'object' || parsed === null) {
        return 'Invalid JSON';
      }

      const keys = Object.keys(parsed);
      if (!keys.length) {
        return '{}';
      }
      if (keys.length === 1) {
        return `{ ${keys[0]}: ... }`;
      }
      return `{ ${keys.length} properties }`;
    } catch {
      return 'Invalid JSON';
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={showNullConfirm ? undefined : handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              'h-full w-full justify-start border-0 p-0 text-left text-sm font-normal text-foreground hover:bg-transparent',
              (!value || value === 'null') && 'text-muted-foreground',
              className
            )}
          >
            <FileJson className="mr-2 h-4 w-4" />
            {formatDisplayValue()}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[32rem] overflow-hidden border-[var(--alpha-12)] bg-card p-0 shadow-xl"
          align="start"
          side="bottom"
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">JSON Editor</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleFormat}
                  disabled={!isValid || !hasJsonText}
                >
                  Format
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMinify}
                  disabled={!isValid || !hasJsonText}
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
                  'h-75 w-full resize-none rounded-md border bg-[var(--alpha-4)] px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground transition-colors',
                  'focus:outline-none focus:shadow-[0_0_0_1px_rgb(var(--foreground))]',
                  isValid
                    ? 'border-[var(--alpha-12)] focus:border-primary'
                    : 'border-destructive focus:border-destructive focus:shadow-[0_0_0_1px_rgb(var(--destructive))]'
                )}
                spellCheck={false}
                autoFocus
              />

              {/* Validation indicator */}
              <Badge
                className={cn(
                  'pointer-events-none absolute bottom-3 right-3 flex items-center gap-1',
                  isValid ? 'bg-primary/15 text-primary' : 'bg-destructive/15 text-destructive'
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
              </Badge>
            </div>

            {/* Error message */}
            {error && (
              <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {/* Tips */}
            <div className="mt-2 rounded border border-[var(--alpha-8)] bg-[var(--alpha-4)] px-2 py-1.5 text-xs text-muted-foreground">
              Tip: Use Tab for indentation, Ctrl+Enter to save, Escape to cancel
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 border-t border-[var(--alpha-8)] bg-[var(--alpha-4)] p-3">
            {nullable && (
              <Button variant="outline" size="sm" onClick={handleSetNull} className="flex-1">
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
              className="flex-1"
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
