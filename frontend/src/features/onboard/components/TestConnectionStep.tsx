import { CodeBlock } from '@/components/CodeBlock';
import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { ClockIcon } from 'lucide-react';
import CheckedIcon from '@/assets/icons/checked.svg';
import { useEffect, useState } from 'react';

const httpUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7130';
const wsUrl = `${httpUrl.replace(/^http/, 'ws')}/ws/onboarding`;

export function TestConnectionStep() {
  const [showSuccess, setShowSuccess] = useState(false);
  const [waitingForResponse, setWaitingForResponse] = useState(false);

  const { backendConnected, connect, disconnect } = useWebSocket(wsUrl);

  // Connect to WebSocket on mount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Show success message when backend connects
  useEffect(() => {
    if (backendConnected) {
      setShowSuccess(true);
    }
  }, [backendConnected]);

  return (
    <div className="space-y-6 bg-white py-8 px-6 rounded-xl border border-border-gray">
      <div>
        <p className="text-zinc-950 text-sm mb-4">
          Open your agent&apos;s chat interface, copy and send this:
        </p>
      </div>

      <CodeBlock
        code="I'm using InsForge as my backend platform, what is my current backend structure?"
        className="bg-slate-50"
        onCopy={() => setWaitingForResponse(true)}
      />

      {waitingForResponse && !showSuccess && (
        <div className="flex items-center gap-2 text-zinc-500">
          <ClockIcon className="w-5 h-5" />
          <p className="text-sm">Waiting for connection</p>
        </div>
      )}

      {showSuccess && (
        <div className="flex items-center gap-2 text-green-700">
          <img src={CheckedIcon} alt="Checked" className="w-5 h-5" />
          <p className="text-sm">API Call Detected, Connection Succeeded</p>
        </div>
      )}
    </div>
  );
}