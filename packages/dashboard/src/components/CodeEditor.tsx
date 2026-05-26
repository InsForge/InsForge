import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { useTheme } from '#lib/contexts/ThemeContext';

interface CodeEditorProps {
  code?: string;
  value?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  editable?: boolean;
  language?: 'sql' | 'javascript' | 'python' | 'plaintext';
  className?: string;
  basicSetup?: boolean | Parameters<typeof CodeMirror>[0]['basicSetup'];
}

export function CodeEditor({
  code,
  value,
  onChange,
  placeholder,
  editable = false,
  language = 'javascript',
  className = '',
  basicSetup,
}: CodeEditorProps) {
  // Use the theme context
  const { resolvedTheme } = useTheme();

  // Support both 'code' (read-only) and 'value' (editable) props
  const displayValue = editable ? value || '' : code || '';

  // Select language extension
  const languageExtension =
    language === 'sql'
      ? sql()
      : language === 'javascript'
        ? javascript()
        : language === 'python'
          ? python()
          : null;
  const extensions = [languageExtension, EditorView.lineWrapping].filter(
    (extension): extension is NonNullable<typeof extension> => extension !== null
  );

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
      '.cm-content': {
        padding: '16px',
      },
      '.cm-line': {
        padding: '0',
      },
      '.cm-placeholder': {
        color: resolvedTheme === 'dark' ? '#737373' : '#9ca3af',
      },
    },
    { dark: resolvedTheme === 'dark' }
  );

  // Select base theme based on current theme
  const baseTheme = resolvedTheme === 'dark' ? vscodeDark : vscodeLight;

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
        basicSetup={
          basicSetup ?? {
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
          }
        }
        placeholder={placeholder}
      />
    </div>
  );
}
