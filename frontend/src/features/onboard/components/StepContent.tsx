import { Step1, Step2, Step3, Step4 } from './steps';

interface StepContentProps {
  step: number;
}

export function StepContent({ step }: StepContentProps) {
  switch (step) {
    case 1:
      return <Step1 />;
    case 2:
      return <Step2 />;
    case 3:
      return <Step3 />;
    case 4:
      return <Step4 />;
    default:
      return (
        <div className="text-center text-zinc-500">
          <p>Step content not found</p>
        </div>
      );
  }
}
