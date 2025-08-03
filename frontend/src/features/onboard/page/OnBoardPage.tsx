import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/radix/Button';
import { useOnboardStep, type OnboardStep, STEP_DESCRIPTIONS } from '@/hooks/useOnboardStep';
import { LinearStepper } from '@/components/Stepper';
import { StepContent } from '../components/StepContent';

export default function OnBoardPage() {
  const navigate = useNavigate();
  const { currentStep, updateStep, totalSteps } = useOnboardStep();

  const handleDismiss = async () => {
    await navigate('/dashboard');
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      updateStep((currentStep + 1) as OnboardStep);
    } else if (currentStep === totalSteps) {
      // Move to completion state (step 5)
      updateStep(5 as OnboardStep);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      updateStep((currentStep - 1) as OnboardStep);
    }
  };

  return (
    <div className="min-h-screen bg-bg-gray">
      <div className="container max-w-[1080px] mx-auto px-6 py-12">
        {/* Header with Linear Stepper */}
        <div className="mb-12 space-y-3">
          <h1 className="text-2xl font-bold text-black">Get Started</h1>
          <LinearStepper
            currentStep={currentStep}
            totalSteps={totalSteps}
            stepLabels={STEP_DESCRIPTIONS}
            isCompleted={currentStep === totalSteps}
          />
        </div>

        {/* Main Content Card */}
        <div className="space-y-3">
          <p className="text-black text-lg font-semibold">
            {currentStep === totalSteps ? 'Setup Complete!' : STEP_DESCRIPTIONS[currentStep - 1]}
          </p>
          <StepContent
            step={currentStep}
            onNavigate={() => {
              void navigate('/dashboard');
            }}
          />

          {/* Action Buttons */}
          {currentStep <= totalSteps && (
            <div className="flex justify-between items-center">
              {/* Dismiss Button - Left */}
              <Button
                variant="outline"
                onClick={() => void handleDismiss()}
                className="h-10 w-30 py-2 text-zinc-950"
              >
                Dismiss
              </Button>

              {/* Navigation Buttons - Right */}
              <div className="flex space-x-4">
                {currentStep > 1 && (
                  <Button
                    variant="outline"
                    onClick={() => void handleBack()}
                    className="h-10 w-30 text-zinc-950"
                  >
                    Back
                  </Button>
                )}
                <Button variant="default" onClick={() => void handleNext()} className="h-10 w-30">
                  {currentStep === totalSteps ? 'Complete' : 'Next'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
