import { CodeBlock } from '@/components';

const TEST_PROMPT =
  "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";

interface VerifyConnectionStepProps {
  onPromptCopied?: () => void;
}

export function VerifyConnectionStep({ onPromptCopied }: VerifyConnectionStepProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Send the prompt below to your AI coding agent to verify the connection.
      </p>
      <CodeBlock
        code={TEST_PROMPT}
        label="prompt"
        className="bg-neutral-200 dark:bg-neutral-900 break-normal"
        onCopy={onPromptCopied}
      />
    </div>
  );
}
