import { CopyButton } from './CopyButton';
import { cn } from '@/lib/utils/utils';

interface JsonHighlightProps {
  json: string;
  textColor?: string;
  className?: string;
}

export function JsonHighlight({ json, textColor, className }: JsonHighlightProps) {
  const highlightJson = (str: string, textColor?: string) => {
    // Tokenize JSON string
    const tokens = str.split(/("(?:[^"\\]|\\.)*")|(\s+)|([:,{}[\]])/g).filter(Boolean);

    return tokens.map((token, index) => {
      // String values (including keys)
      if (token.startsWith('"') && token.endsWith('"')) {
        // Check if this is a key (next non-whitespace token is ':')
        let isKey = false;
        for (let i = index + 1; i < tokens.length; i++) {
          if (tokens[i].trim()) {
            isKey = tokens[i] === ':';
            break;
          }
        }

        if (isKey) {
          return (
            <span key={index} className={cn('text-blue-600 dark:text-blue-400', textColor)}>
              {token}
            </span>
          );
        } else {
          return (
            <span key={index} className={cn('text-green-600 dark:text-green-400', textColor)}>
              {token}
            </span>
          );
        }
      }

      // Punctuation
      if (/^[:,{}[\]]$/.test(token)) {
        return (
          <span key={index} className={cn('text-gray-600 dark:text-gray-400', textColor)}>
            {token}
          </span>
        );
      }

      // Whitespace and other
      return (
        <span key={index} className={textColor}>
          {token}
        </span>
      );
    });
  };

  return (
    <div className="relative">
      <pre
        className={cn(
          'font-mono text-sm leading-6 whitespace-pre overflow-x-auto bg-gray-50 dark:bg-neutral-900 dark:text-white rounded-md py-4 px-6 pr-16',
          className
        )}
      >
        {highlightJson(json, textColor)}
      </pre>
      <CopyButton variant="primary" text={json} className="absolute top-3.5 right-3.5 pl-2" />
    </div>
  );
}
