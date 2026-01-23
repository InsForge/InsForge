import { CodeBlock } from '@/components';
import verifyConnectionVideo from '@/assets/videos/terminal_install.mp4';

const TEST_PROMPT =
  "I'm using InsForge as my backend platform, call InsForge MCP's fetch-docs tool to learn about InsForge instructions.";

export function VerifyConnectionStep() {
  return (
    <div className="flex flex-col gap-2">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Send the prompt below to your AI coding agent to verify the connection.
      </p>
      <CodeBlock
        code={TEST_PROMPT}
        label="prompt"
        className="bg-neutral-200 dark:bg-neutral-900 break-normal"
      />
      {/* Video Container */}
      <div className="w-full rounded overflow-hidden mt-2">
        <video
          src={verifyConnectionVideo}
          autoPlay
          loop
          muted
          playsInline
          className="w-full h-full object-cover"
          aria-label="Demo of verifying connection with an AI coding agent"
        />
      </div>
    </div>
  );
}
