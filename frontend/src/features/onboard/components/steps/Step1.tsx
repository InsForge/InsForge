import { CodeBlock } from '@/components/CodeBlock';

export function Step1() {
  return (
    <div className="bg-white py-8 px-6 space-y-4">
      <div>
        <p className="text-zinc-950 text-sm mb-4">
          Install{' '}
          <a
            href="https://nodejs.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-link-blue underline inline-flex items-center gap-1"
          >
            Node.js
          </a>
          . Visit the official Node.js website at{' '}
          <a
            href="https://nodejs.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-link-blue underline"
          >
            https://nodejs.org/
          </a>
        </p>
        <p className="text-zinc-950 text-sm">
          Verify installation by opening a terminal and running:
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CodeBlock code="node --version" />
        <CodeBlock code="npm --version" />
      </div>
    </div>
  );
}
