import { InsForgeDashboard } from '@insforge/dashboard';
import { isInIframe } from '../helpers';
import { useCloudHosting } from './useCloudHosting';

export function CloudHostingDashboard() {
  const {
    getAuthorizationCode,
    projectInfo,
    initialRoute,
    reportRouteChange,
    navigateToSubscription,
    renameProject,
    deleteProject,
    requestInstanceInfo,
    requestInstanceTypeChange,
    updateVersion,
  } = useCloudHosting();

  return (
    <InsForgeDashboard
      mode="cloud-hosting"
      showNavbar={!isInIframe()}
      getAuthorizationCode={getAuthorizationCode}
      project={projectInfo}
      initialRoute={initialRoute}
      onRouteChange={reportRouteChange}
      onNavigateToSubscription={navigateToSubscription}
      onRenameProject={renameProject}
      onDeleteProject={deleteProject}
      onRequestInstanceInfo={requestInstanceInfo}
      onRequestInstanceTypeChange={requestInstanceTypeChange}
      onUpdateVersion={updateVersion}
    />
  );
}
