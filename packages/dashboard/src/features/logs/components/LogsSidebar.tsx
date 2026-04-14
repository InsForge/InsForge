import { FeatureSidebar } from '../../../components';
import { useLogSources } from '../hooks/useLogSources';

export function LogsSidebar() {
  const { menuItems, isLoading } = useLogSources();

  return <FeatureSidebar title="Logs" items={menuItems} loading={isLoading} />;
}
