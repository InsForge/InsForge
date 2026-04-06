import { InsForgeDashboard } from '@insforge/dashboard';
import { isCloudHostingBackend, useCloudHostingBridge } from './cloudHostingHelpers';

const backendUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:7130';

function CloudHostedApp() {
  const bridge = useCloudHostingBridge(backendUrl);

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
      backendUrl={backendUrl}
      showNavbar={false}
      getAuthorizationCode={bridge.getAuthorizationCode}
      project={bridge.projectInfo}
      onNavigateToSubscription={bridge.navigateToSubscription}
      onRenameProject={bridge.renameProject}
      onDeleteProject={bridge.deleteProject}
      onRequestInstanceInfo={bridge.requestInstanceInfo}
      onRequestInstanceTypeChange={bridge.requestInstanceTypeChange}
      onUpdateVersion={bridge.updateVersion}
    />
  );
}

function App() {
  if (isCloudHostingBackend()) {
    return <CloudHostedApp />;
  }

  return <InsForgeDashboard mode="self-hosting" backendUrl={backendUrl} />;
}

export default App;
