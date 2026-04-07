import { InsForgeDashboard } from '@insforge/dashboard';
import { useCloudHostBridge } from './useCloudHostBridge';

type CloudHostingDashboardProps = {
  backendUrl: string;
};

export function CloudHostingDashboard({ backendUrl }: CloudHostingDashboardProps) {
  const bridge = useCloudHostBridge(backendUrl);

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
