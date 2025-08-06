import { CopyButton } from './CopyButton';

interface JsonHighlightProps {
  json: string;
}

export function JsonHighlight({ json }: JsonHighlightProps) {
  const highlightJson = (str: string) => {
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
            <span key={index} className="text-blue-600">
              {token}
            </span>
          );
        } else {
          return (
            <span key={index} className="text-green-600">
              {token}
            </span>
          );
        }
      }

      // Punctuation
      if (/^[:,{}[\]]$/.test(token)) {
        return (
          <span key={index} className="text-gray-600">
            {token}
          </span>
        );
      }

      // Whitespace and other
      return <span key={index}>{token}</span>;
    });
  };

  return (
    <div className="relative">
      <pre className="font-mono text-sm leading-6 whitespace-pre overflow-x-auto bg-gray-50 rounded-md py-4 px-6 pr-16">
        {highlightJson(json)}
      </pre>
      <CopyButton text={json} className="absolute top-4 right-4" />
    </div>
  );
}
