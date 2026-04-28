import { useEffect, useState } from 'react';
import { InsForgeDashboard } from '@insforge/dashboard';
import { FakeCloudNavbar } from './FakeCloudNavbar';
import { FAKE_PROJECT, STUB_CALLBACKS, MOCK_CLOUD_FLAG } from './fixtures';

export function FakeCloudDashboard() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (window as unknown as Record<string, unknown>)[MOCK_CLOUD_FLAG] = true;
    setReady(true);
    return () => {
      delete (window as unknown as Record<string, unknown>)[MOCK_CLOUD_FLAG];
    };
  }, []);

  if (!ready) {
    return null;
  }

  return (
    <div className="flex h-screen flex-col">
      <FakeCloudNavbar />
      <div className="min-h-0 flex-1">
        <InsForgeDashboard mode="cloud-hosting" project={FAKE_PROJECT} {...STUB_CALLBACKS} />
      </div>
    </div>
  );
}
