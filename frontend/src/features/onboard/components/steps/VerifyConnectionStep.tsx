import { CodeBlock } from '@/components';

const TEST_PROMPT =
  "I'm using InsForge as my backend platform, what is my current backend structure?";

export function VerifyConnectionStep() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-neutral-400 text-sm leading-6">
        Send the prompt below to your AI coding agent to verify the connection.
      </p>
      <CodeBlock code={TEST_PROMPT} label="prompt" className="bg-neutral-900" />
    </div>
  );
}
