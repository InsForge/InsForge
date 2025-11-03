import { useEffect, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';

interface CodeEditorProps {
  code?: string;
  value?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  editable?: boolean;
  language?: 'sql' | 'javascript';
  className?: string;
}

export function CodeEditor({
  code,
  value,
  onChange,
  placeholder,
  editable = false,
  language = 'javascript',
  className = '',
}: CodeEditorProps) {
  // Detect theme from the document
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    // Watch for theme changes
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // Support both 'code' (read-only) and 'value' (editable) props
  const displayValue = editable ? value || '' : code || '';

  // Select language extension
  const extensions = [language === 'sql' ? sql() : javascript(), EditorView.lineWrapping];

  // Custom theme extension to override background and make it transparent
  const customTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: 'transparent',
        height: '100%',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        border: 'none',
      },
      '.cm-placeholder': {
        color: isDark ? '#737373' : '#9ca3af',
      },
    },
    { dark: isDark }
  );

  // Select base theme based on current theme
  const baseTheme = isDark ? vscodeDark : vscodeLight;

  return (
    <div className={`h-full overflow-auto ${className}`}>
      <CodeMirror
        value={displayValue}
        height="100%"
        theme={[baseTheme, customTheme]}
        extensions={extensions}
        onChange={onChange}
        editable={editable}
        readOnly={!editable}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: false,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: false,
          completionKeymap: true,
          lintKeymap: true,
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
