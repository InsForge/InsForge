import { useState, useMemo, useCallback, useEffect } from 'react';
import { Loader2, ChevronUp, ChevronDown, ChevronsUpDown, Settings } from 'lucide-react';
import { useAIConfigs } from '#features/ai/hooks/useAIConfigs';
import { useAIRemainingCredits } from '#features/ai/hooks/useAIUsage';
import { useConfirm } from '#lib/hooks/useConfirm';
import { isInsForgeCloudProject } from '#lib/utils/utils';
import { Tabs, Tab, ConfirmDialog, Button } from '@insforge/ui';
import {
  generateProviderTabs,
  filterModelsByProvider,
  toModelOption,
  formatCredits,
  type SortField,
  type SortDirection,
} from '#features/ai/helpers';
import { GatewayConfigDialog, ModelRow } from '#features/ai/components';
import type { AIModelSchema } from '@insforge/shared-schemas';

export default function AIPage() {
  const {
    allAvailableModels,
    configurationOptions,
    configuredModelIds,
    isLoadingModels,
    isLoadingConfigurations,
    createConfiguration,
    deleteConfiguration,
  } = useAIConfigs();

  const isCloud = isInsForgeCloudProject();

  // Dynamically generate provider tabs from available models
  const providers = useMemo(() => generateProviderTabs(allAvailableModels), [allAvailableModels]);

  const { data: credits, error: getAICreditsError } = useAIRemainingCredits(!isCloud);
  const { confirm, confirmDialogProps } = useConfirm();

  const [activeTab, setActiveTab] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('inputPrice');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);

  // Set default active tab when providers are loaded
  useEffect(() => {
    if (providers.length > 0 && !activeTab) {
      setActiveTab(providers[0].id);
    }
  }, [providers, activeTab]);

  // Create a map from modelId to configuration for quick lookup
  const configurationMap = useMemo(() => {
    const map = new Map<string, { id: string; totalRequests: number }>();
    configurationOptions.forEach((config) => {
      map.set(config.modelId, {
        id: config.id,
        totalRequests: config.usageStats?.totalRequests || 0,
      });
    });
    return map;
  }, [configurationOptions]);

  // Get models for the active provider tab with sorting
  const modelsForActiveProvider = useMemo(() => {
    const models = filterModelsByProvider(allAvailableModels, activeTab).map(toModelOption);

    // Sort models
    return [...models].sort((a, b) => {
      let aValue: number;
      let bValue: number;

      if (sortField === 'requests') {
        aValue = configurationMap.get(a.modelId)?.totalRequests || 0;
        bValue = configurationMap.get(b.modelId)?.totalRequests || 0;
      } else if (sortField === 'inputPrice') {
        aValue = a.inputPrice || 0;
        bValue = b.inputPrice || 0;
      } else {
        aValue = a.outputPrice || 0;
        bValue = b.outputPrice || 0;
      }

      return sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
    });
  }, [allAvailableModels, activeTab, sortField, sortDirection, configurationMap]);

  // Handle sort click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    const isActive = sortField === field;
    return (
      <div className="ml-0.5 inline-flex h-4 w-4 items-center justify-center text-muted-foreground">
        {isActive && sortDirection === 'asc' && <ChevronUp className="h-3.5 w-3.5" />}
        {isActive && sortDirection === 'desc' && <ChevronDown className="h-3.5 w-3.5" />}
        {!isActive && (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    );
  };

  const handleToggleModel = useCallback(
    async (model: AIModelSchema, isCurrentlyEnabled: boolean) => {
      if (isCurrentlyEnabled) {
        // Disable: find configuration and delete
        const config = configurationMap.get(model.modelId);
        if (config) {
          const shouldDelete = await confirm({
            title: 'Disable AI Model',
            description: `Are you sure you want to disable ${model.modelId.split('/')[1]}? Usage history will be preserved.`,
            confirmText: 'Disable',
            destructive: true,
          });
          if (shouldDelete) {
            deleteConfiguration(config.id);
          }
        }
      } else {
        // Enable: create configuration
        createConfiguration({
          provider: model.provider,
          modelId: model.modelId,
          inputModality: model.inputModality,
          outputModality: model.outputModality,
        });
      }
    },
    [configurationMap, confirm, deleteConfiguration, createConfiguration]
  );

  const handleSwitchChange = useCallback(
    (modelId: string, isEnabled: boolean) => {
      const model = allAvailableModels.find((m) => m.modelId === modelId);
      if (model) {
        void handleToggleModel(model, isEnabled);
      }
    },
    [allAvailableModels, handleToggleModel]
  );

  const isLoading = isLoadingModels || isLoadingConfigurations;

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--semantic-0))]">
      {/* Header Section - Fixed */}
      <div className="flex flex-col items-center px-10 flex-shrink-0">
        <div className="max-w-[1024px] w-full flex flex-col gap-6 pt-10 pb-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-medium text-foreground leading-8">Model Gateway</h1>
                {credits?.remaining && (
                  <span className="text-sm font-normal text-primary mt-[2.5px]">
                    {formatCredits(credits.remaining)} credit{credits.remaining !== 1 ? 's' : ''}{' '}
                    left
                  </span>
                )}
              </div>
              <Button
                variant="secondary"
                onClick={() => setAISettingsOpen(true)}
                className="h-9 rounded px-2 text-foreground"
              >
                <Settings className="h-5 w-5 stroke-[1.7]" />
                <span className="px-1">Gateway credentials</span>
              </Button>
            </div>
            <p className="text-sm leading-5 text-muted-foreground">
              Your models are ready — build LLM-powered features or add more integrations.
            </p>
          </div>

          {/* Provider Tabs - Full Width */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            {providers.map((provider) => {
              const Logo = provider.logo;
              return (
                <Tab key={provider.id} value={provider.id} className="flex-1">
                  {Logo && <Logo className="w-5 h-5" />}
                  {provider.displayName}
                </Tab>
              );
            })}
          </Tabs>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-10">
        <div className="max-w-[1024px] w-full mx-auto pt-2 pb-6">
          {getAICreditsError ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm font-normal">{getAICreditsError.message}</p>
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : modelsForActiveProvider.length === 0 ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No models available for{' '}
              {providers.find((p) => p.id === activeTab)?.displayName || activeTab}
            </div>
          ) : (
            <div className="bg-card border border-[var(--alpha-8)] rounded py-2 flex flex-col">
              {/* Table Header - Fixed */}
              <div className="grid grid-cols-[minmax(0,2fr)_1fr_1fr_1fr_1fr_1fr] gap-x-2.5 h-8 items-center text-sm leading-5 text-muted-foreground px-4 border-b border-[var(--alpha-8)] shrink-0">
                <div>Model</div>
                <div>Input</div>
                <button
                  onClick={() => handleSort('inputPrice')}
                  className="group flex items-center gap-1 hover:text-foreground transition-colors"
                  aria-sort={
                    sortField === 'inputPrice'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Input Price
                  <SortIndicator field="inputPrice" />
                </button>
                <div>Output</div>
                <button
                  onClick={() => handleSort('outputPrice')}
                  className="group flex items-center gap-1 hover:text-foreground transition-colors"
                  aria-sort={
                    sortField === 'outputPrice'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Output Price
                  <SortIndicator field="outputPrice" />
                </button>
                <button
                  onClick={() => handleSort('requests')}
                  className="group flex items-center gap-1 justify-end hover:text-foreground transition-colors"
                  aria-sort={
                    sortField === 'requests'
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  Requests
                  <SortIndicator field="requests" />
                </button>
              </div>

              {/* Table Body - Scrollable */}
              <div>
                {modelsForActiveProvider.map((model) => (
                  <ModelRow
                    key={model.modelId}
                    model={model}
                    isEnabled={configuredModelIds.includes(model.modelId)}
                    requests={configurationMap.get(model.modelId)?.totalRequests || 0}
                    onToggle={handleSwitchChange}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />

      {/* Gateway Credentials Dialog */}
      <GatewayConfigDialog open={aiSettingsOpen} onOpenChange={setAISettingsOpen} />
    </div>
  );
}
