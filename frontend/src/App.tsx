import { InsForgeDashboard } from '@insforge/dashboard';

const backendUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7130';

function App() {
  return <InsForgeDashboard mode="self-hosting" backendUrl={backendUrl} />;
}

export default App;
