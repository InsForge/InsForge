import { InsForgeDashboard } from '@insforge/dashboard';
import { useCloudHostBridge } from './useCloudHostBridge';

export function CloudHostingDashboard() {
  const bridge = useCloudHostBridge();

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
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
