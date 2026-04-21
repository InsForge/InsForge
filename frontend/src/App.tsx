import { CloudHostingDashboard } from './cloud-hosting/CloudHostingDashboard';
import { isCloudHosting } from './helpers';
import { SelfHostingDashboard } from './self-hosting/SelfHostingDashboard';
import { FakeCloudDashboard } from './mock-cloud/FakeCloudDashboard';

function App() {
  if (import.meta.env.VITE_MOCK_CLOUD === 'true') {
    return <FakeCloudDashboard />;
  }

  if (isCloudHosting()) {
    return <CloudHostingDashboard />;
  }

  return <SelfHostingDashboard />;
}

export default App;
