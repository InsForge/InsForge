import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, SearchInput } from '@insforge/ui';
import type { MarketplacePluginWithStatus } from '@insforge/shared-schemas';
import { InstallPluginDialog } from '#features/marketplace/components/InstallPluginDialog';
import { PluginCard } from '#features/marketplace/components/PluginCard';
import { useMarketplace } from '#features/marketplace/hooks/useMarketplace';
import { useCloudProjectInfo } from '#lib/hooks/useCloudProjectInfo';
import { isInsForgeCloudProject } from '#lib/utils/utils';

export default function MarketplacePage() {
  const { projectInfo } = useCloudProjectInfo();
  const projectName =
    isInsForgeCloudProject() && projectInfo.name ? projectInfo.name : 'My InsForge Project';

  const {
    plugins,
    isLoading,
    error,
    installPlugin,
    isInstalling,
    uninstallPlugin,
    isUninstalling,
  } = useMarketplace();

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [dialogSlug, setDialogSlug] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const categories = useMemo(
    () => ['All', ...new Set(plugins.map((plugin) => plugin.category))],
    [plugins]
  );

  const visiblePlugins = useMemo(() => {
    const q = query.trim().toLowerCase();
    return plugins
      .filter((plugin) => category === 'All' || plugin.category === category)
      .filter(
        (plugin) =>
          !q ||
          plugin.name.toLowerCase().includes(q) ||
          plugin.description.toLowerCase().includes(q) ||
          plugin.publisher.toLowerCase().includes(q)
      );
  }, [plugins, query, category]);

  // Resolve from fresh data so the dialog reflects install-state changes
  const dialogPlugin = plugins.find((plugin) => plugin.slug === dialogSlug) ?? null;

  const openDialog = (plugin: MarketplacePluginWithStatus) => {
    setDialogSlug(plugin.slug);
    setDialogOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-12 py-10">
      <div className="flex items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[28px] font-semibold leading-tight text-foreground">
            Marketplace
          </h1>
          <p className="m-0 text-sm text-muted-foreground">
            Add plugins and integrations to your project with one click.
          </p>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search plugins..."
          debounceTime={0}
          className="w-[300px]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {categories.map((label) => (
          <Button
            key={label}
            variant={category === label ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setCategory(label)}
          >
            {label}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <span className="text-[15px] font-medium text-foreground">
            Failed to load the marketplace
          </span>
          <span className="text-[13px] text-muted-foreground">{error.message}</span>
        </div>
      ) : visiblePlugins.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          {visiblePlugins.map((plugin) => (
            <PluginCard key={plugin.slug} plugin={plugin} onOpen={() => openDialog(plugin)} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16">
          <span className="text-[15px] font-medium text-foreground">No plugins found</span>
          <span className="text-[13px] text-muted-foreground">
            Try a different search or category.
          </span>
        </div>
      )}
      <InstallPluginDialog
        plugin={dialogPlugin}
        projectName={projectName}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onInstall={(slug, apiKey) => installPlugin({ slug, apiKey })}
        installing={isInstalling}
        onUninstall={uninstallPlugin}
        uninstalling={isUninstalling}
      />
    </div>
  );
}
