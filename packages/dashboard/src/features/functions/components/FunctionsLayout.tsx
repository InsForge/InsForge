import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { FunctionsSidebar } from './FunctionsSidebar';
import { FunctionsSettingsDialog } from './FunctionsSettingsDialog';

export default function FunctionsLayout() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <FunctionsSidebar onOpenSettings={() => setIsSettingsOpen(true)} />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </div>
      <FunctionsSettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </div>
  );
}
