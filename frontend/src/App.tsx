import { CloudHostingDashboard } from './cloud-hosting/CloudHostingDashboard';
import { isCloudHosting } from './helpers';
import { SelfHostingDashboard } from './self-hosting/SelfHostingDashboard';

function App() {
  if (isCloudHosting()) {
    return <CloudHostingDashboard />;
  }

  return <SelfHostingDashboard />;
}

export default App;
