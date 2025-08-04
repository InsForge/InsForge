import { Button } from '@/components/radix/Button';
import CheckedIcon from '@/assets/icons/checked.svg';
import { useNavigate } from 'react-router-dom';
import { useOnboardingCompletion } from '@/lib/hooks/useOnboardingCompletion';
import { useEffect } from 'react';

export function CompletionCard() {
  const navigate = useNavigate();
  const { markAsCompleted } = useOnboardingCompletion();

  // Mark as completed when this component is mounted
  useEffect(() => {
    markAsCompleted();
  }, [markAsCompleted]);

  const handleNavigate = () => {
    navigate('/dashboard');
  };

  return (
    <div className="bg-white py-8 px-6 rounded-xl border border-border-gray">
      <div className="flex flex-col items-center justify-center gap-8">
        <div className="flex flex-col items-center justify-center gap-4">
          <img src={CheckedIcon} alt="Checked" className="w-10 h-10" />
          <p className="text-lg font-semibold text-black">You are all set!</p>
          <p className="text-zinc-500 text-sm">
            Your AI agent is now full-stack — powered by <b>InsForge</b>.
            <br /> Let&apos;s build something <b>real</b>.
          </p>
        </div>
        <Button
          variant="default"
          className="px-4 py-2 h-10 text-sm font-medium"
          onClick={handleNavigate}
        >
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}
