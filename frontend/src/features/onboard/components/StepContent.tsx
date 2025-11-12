import { OnboardStep } from '../types';
import { CodeBlock } from '@/components/CodeBlock';
import { McpInstallation } from '@/features/onboard/components/mcp';

interface StepContentProps {
  step: OnboardStep;
}

export function StepContent({ step }: StepContentProps) {
  switch (step) {
    case OnboardStep.INSTALL_NODEJS:
      return (
        <div className="border border-neutral-200 dark:border-[#333333] rounded-[8px] bg-white dark:bg-[#333333] p-6 space-y-4">
          <div>
            <p className="text-zinc-950 dark:text-white text-sm mb-4">
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
            <p className="text-zinc-950 dark:text-white text-sm">
              Verify installation by opening a terminal and running:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CodeBlock code="node --version" className="dark:bg-neutral-700 dark:text-white" />
            <CodeBlock code="npm --version" className="dark:bg-neutral-700 dark:text-white" />
          </div>
        </div>
      );

    case OnboardStep.INSTALL_MCP:
      return <McpInstallation TabListClassName="dark:bg-[#333333]" />;

    case OnboardStep.TEST_CONNECTION:
      return (
        <div className="space-y-6 border border-neutral-200 dark:border-[#333333] rounded-[8px] bg-white dark:bg-[#333333] p-6">
          <div>
            <p className="text-zinc-950 dark:text-white text-sm mb-4">
              Copy the prompt below and send it to your agent. The moment we detect that first call,
              the connection is complete.
            </p>
          </div>

          <CodeBlock
            code="I'm using InsForge as my backend platform, what is my current backend structure?"
            className="bg-slate-50 dark:bg-neutral-700 dark:text-white"
          />
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
