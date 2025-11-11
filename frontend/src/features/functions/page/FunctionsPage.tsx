import { useState, useEffect } from 'react';
import { FunctionsSidebar } from '@/features/functions/components/FunctionsSidebar';
import { FunctionsContent } from '@/features/functions/components/FunctionsContent';
import { SecretsContent } from '@/features/functions/components/SecretsContent';
import { CronJobsContent } from '@/features/functions/components/CronJobsContent';
export default function FunctionsPage() {
  // Load selected section from localStorage on mount
  const [selectedSection, setSelectedSection] = useState<'functions' | 'secrets' | 'schedules'>(
    () => {
      return (
        (localStorage.getItem('selectedFunctionSection') as
          | 'functions'
          | 'secrets'
          | 'schedules') || 'functions'
      );
    }
  );

  // Save selected section to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('selectedFunctionSection', selectedSection);
  }, [selectedSection]);

  return (
    <div className="h-full flex">
      <FunctionsSidebar selectedSection={selectedSection} onSectionSelect={setSelectedSection} />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedSection === 'functions' ? (
          <FunctionsContent />
        ) : selectedSection === 'secrets' ? (
          <SecretsContent />
        ) : (
          <CronJobsContent />
        )}
      </div>
    </div>
  );
}
