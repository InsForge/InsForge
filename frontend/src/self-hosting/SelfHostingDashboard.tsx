import { InsForgeDashboard } from '@insforge/dashboard';

type SelfHostingDashboardProps = {
  backendUrl: string;
};

export function SelfHostingDashboard({ backendUrl }: SelfHostingDashboardProps) {
  return <InsForgeDashboard mode="self-hosting" backendUrl={backendUrl} />;
}
