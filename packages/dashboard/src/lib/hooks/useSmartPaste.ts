import { useCallback } from 'react';

export function useSmartPaste<TParsed>({
  parse,
  onParsed,
  focusRef,
}: {
  parse: (text: string) => TParsed | null;
  onParsed: (parsed: TParsed) => void;
  focusRef?: React.RefObject<HTMLElement | null>;
}) {
  return useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData('text');
      const parsed = parse(pasted);
      if (!parsed) {
        return;
      }

      e.preventDefault();
      onParsed(parsed);

      if (focusRef?.current) {
        queueMicrotask(() => focusRef.current?.focus());
      }
    },
    [focusRef, onParsed, parse]
  );
}
