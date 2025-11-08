import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { OnboardStep } from '../types';
import { StepContent } from '../components/StepContent';
import LoaderIcon from '@/assets/icons/loader.svg?react';
import ConnectedIcon from '@/assets/icons/connected.svg?react';
import { ServerEvents, useSocket } from '@/lib/contexts/SocketContext';
import type { McpConnectedPayload } from '@/features/logs/hooks/useMcpUsage';

const STEP_DESCRIPTIONS = [
  'Install Node.js',
  'Install InsForge MCP',
  'Test the Connection',
] as const;

const STEPS = [
  { id: OnboardStep.INSTALL_NODEJS, title: STEP_DESCRIPTIONS[0] },
  { id: OnboardStep.INSTALL_MCP, title: STEP_DESCRIPTIONS[1] },
  { id: OnboardStep.TEST_CONNECTION, title: STEP_DESCRIPTIONS[2] },
] as const;

export default function OnBoardPage() {
  const [mcpDetected, setMcpDetected] = useState(false);
  const navigate = useNavigate();
  const { socket } = useSocket();

  // Navigate to dashboard on successful connection
  useEffect(() => {
    if (!socket) {
      return;
    }
    const handleMcpCallDetected = (_data: McpConnectedPayload) => {
      setMcpDetected(true);
      // Navigate to dashboard to show success message
      void navigate('/dashboard', { state: { showSuccessBanner: true } });
    };

    socket.on(ServerEvents.MCP_CONNECTED, handleMcpCallDetected);

    return () => {
      socket.off(ServerEvents.MCP_CONNECTED, handleMcpCallDetected);
    };
  }, [socket, navigate]);

  return (
    <div className="h-full flex flex-col bg-bg-gray dark:bg-neutral-800">
      {/* Fixed Header */}
      <div className="flex-shrink-0">
        <div className="max-w-[1200px] mx-auto px-6 pt-12 pb-6 flex flex-col items-start justify-center gap-3">
          {!mcpDetected ? (
            <div className="flex items-center justify-start gap-2">
              <LoaderIcon className="dark:text-emerald-400 text-zinc-950 animate-spin" />
              <p className="text-base text-neutral-700 dark:text-neutral-300">
                Waiting for Connection
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <ConnectedIcon className="w-6 h-6 text-zinc-950 dark:text-green-500" />
              <p className="text-base text-neutral-700 dark:text-neutral-300">
                Successfully Connected! Redirecting to Dashboard...
              </p>
            </div>
          )}
          <h1 className="text-xl font-semibold text-black dark:text-white">
            Get Started by Connecting to Your Coding Agent
          </h1>
        </div>
        <div className="w-full border-t border-neutral-200 dark:border-neutral-700 h-px" />
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1128px] mx-auto py-10 mb-32 flex flex-row gap-6">
          {/* Left: Vertical Stepper line */}
          <div className="flex-shrink-0 pt-1">
            <div className="w-px flex-1 h-full bg-neutral-400 dark:bg-neutral-600 mx-3" />
          </div>

          {/* Right: All Step Contents */}
          <div className="flex-1">
            <div className="space-y-16">
              {STEPS.map((step, index) => (
                <div key={step.id} id={`step-${step.id}`} className="relative">
                  {/* Step number circle */}
                  <div className="absolute top-0.5 -left-9 -translate-x-1/2 w-6 h-6 bg-white dark:bg-zinc-800 border border-black dark:border-white text-black dark:text-white rounded-full flex items-center justify-center">
                    <span className="text-sm text-center w-full select-none">{index + 1}</span>
                  </div>

                  {/* Step title and content */}
                  <h2 className="text-xl font-semibold text-zinc-950 dark:text-white mb-3">
                    {step.title}
                  </h2>
                  <StepContent step={step.id} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
