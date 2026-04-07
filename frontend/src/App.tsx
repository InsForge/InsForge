import { CloudHostingDashboard } from './cloud-hosting/CloudHostingDashboard';
import { isCloudHosting } from './helpers';
import { SelfHostingDashboard } from './self-hosting/SelfHostingDashboard';

const backendUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:7130';

function App() {
  if (isCloudHosting()) {
    return <CloudHostingDashboard backendUrl={backendUrl} />;
  }

  return <SelfHostingDashboard backendUrl={backendUrl} />;
}

export default App;
