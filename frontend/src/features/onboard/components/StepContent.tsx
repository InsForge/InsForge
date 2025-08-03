import { CodeBlock } from '@/components/CodeBlock';
import { MCPInstaller } from '@/components/mcp';
interface StepContentProps {
  step: number;
}

export function StepContent({ step }: StepContentProps) {
  switch (step) {
    case 1:
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

    case 2:
      return <MCPInstaller />;

    case 3:
      return (
        <div className="space-y-6 bg-white py-8 px-6 rounded-xl border border-border-gray">
          <div>
            <p className="text-zinc-950 text-sm mb-4">
              Open your agent&apos;s chat interface, type and send this:
            </p>
          </div>

          <CodeBlock
            code="I'm using InsForge as my backend platform, what is my current backend structure?"
            className="bg-slate-50"
          />
        </div>
      );

    case 4:
      return (
        <div className="space-y-6 bg-white py-8 px-6 rounded-xl border border-border-gray">
          <div>
            <p className="text-zinc-950 text-sm mb-4">
              Whenever you start a new chat session, init your AI agents with the InsForge init
              prompt:
            </p>
          </div>

          <CodeBlock code="Learn how to use InsForge + xxxxxx" className="bg-slate-50" />

          <div>
            <p className="text-zinc-950 text-sm">Then you can start building!</p>
          </div>
        </div>
      );

    default:
      return (
        <div className="text-center text-zinc-500">
          <p>Step content not found</p>
        </div>
      );
  }
}
