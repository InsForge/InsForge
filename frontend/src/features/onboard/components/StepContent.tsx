import { CodeBlock } from '@/components/CodeBlock';
import { MCPInstaller } from '@/components/mcp';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import CheckedIcon from '@/assets/icons/checked.svg';
import { useEffect, useState } from 'react';

interface StepContentProps {
  step: number;
}

export function StepContent({ step }: StepContentProps) {
  const [showSuccess, setShowSuccess] = useState(false);

  // Get WebSocket URL from current location
  const wsUrl = `ws://localhost:7130/ws/onboarding`;
  const { mcpConnected, connect, disconnect } = useWebSocket(wsUrl);

  // Connect to WebSocket when entering step 3
  useEffect(() => {
    if (step === 3) {
      connect();
      return () => {
        disconnect();
      };
    }
  }, [step, connect, disconnect]);

  // Show success message when backend connects
  useEffect(() => {
    if (mcpConnected) {
      setShowSuccess(true);
    }
  }, [mcpConnected]);

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

          {showSuccess && (
            <div className="flex items-center gap-2">
              <img src={CheckedIcon} alt="Checked" className="w-5 h-5 text-green-700" />
              <p className="text-sm text-green-700">API Call Detected, Connection Succeeded</p>
            </div>
          )}
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

          <CodeBlock code="Learn how to use InsForge" className="bg-slate-50" />

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
