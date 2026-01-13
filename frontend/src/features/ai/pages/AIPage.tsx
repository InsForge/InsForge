import { useState, useMemo, useCallback } from 'react';
import { Loader2, ArrowUp, ArrowDown } from 'lucide-react';
import { ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent, Switch } from '@/components';
import { useAIConfigs } from '../hooks/useAIConfigs';
import { useAIRemainingCredits } from '../hooks/useAIUsage';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { isInsForgeCloudProject } from '@/lib/utils/utils';
import {
  CLOUD_PROVIDERS,
  SELF_HOSTED_PROVIDERS,
  filterModelsByProvider,
  toModelOption,
} from '../helpers';
import type { AIModelSchema } from '@insforge/shared-schemas';

type SortField = 'inputPrice' | 'outputPrice' | 'requests';
type SortDirection = 'asc' | 'desc';

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
  const providers = isCloud ? CLOUD_PROVIDERS : SELF_HOSTED_PROVIDERS;

  const { data: credits } = useAIRemainingCredits(!isCloud);
  const { confirm, confirmDialogProps } = useConfirm();

  const [activeTab, setActiveTab] = useState(providers[0]?.id || 'openai');
  const [sortField, setSortField] = useState<SortField>('inputPrice');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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
      // Toggle direction if same field
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      // New field, default to desc
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return null;
    }
    return sortDirection === 'desc' ? (
      <ArrowDown className="w-4 h-4" />
    ) : (
      <ArrowUp className="w-4 h-4" />
    );
  };

  // Format credits display
  const formatCredits = (remaining: number) => {
    if (remaining >= 1000) {
      return `${(remaining / 1000).toFixed(1)}K`;
    }
    return remaining.toFixed(2);
  };

  // Format price per million tokens
  const formatPrice = (price?: number) => {
    if (price === undefined || price === 0) {
      return 'Free';
    }
    if (price < 0.01) {
      return `$${price.toFixed(4)}`;
    }
    if (price < 1) {
      return `$${price.toFixed(2)}`;
    }
    return `$${price.toFixed(1)}`;
  };

  const handleToggleModel = useCallback(
    async (model: AIModelSchema, isCurrentlyEnabled: boolean) => {
      if (isCurrentlyEnabled) {
        // Disable: find configuration and delete
        const config = configurationMap.get(model.modelId);
        if (config) {
          const shouldDelete = await confirm({
            title: 'Disable AI Model',
            description: `Are you sure you want to disable ${model.modelId.split('/')[1]}? This will remove the configuration.`,
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
    <div className="h-full flex flex-col bg-white dark:bg-neutral-800 pt-8">
      {/* Header Section - Fixed */}
      <div className="max-w-[1080px] mx-auto w-full flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-black dark:text-white leading-7">AI Router</h1>
          {credits?.remaining && (
            <span className="text-sm font-normal text-neutral-700 dark:text-emerald-300 mt-[2.5px]">
              {formatCredits(credits.remaining)} credit{credits.remaining !== 1 ? 's' : ''} left
            </span>
          )}
        </div>
        <p className="text-sm leading-6 text-neutral-500 dark:text-neutral-400">
          Your models are ready — build LLM-powered features or add more integration.
        </p>
      </div>

      {/* Provider Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0 mt-6"
      >
        {/* Tabs List */}
        <TabsList className="bg-transparent border-b border-neutral-200 dark:border-neutral-700 rounded-none h-auto p-0 justify-start gap-0 flex-shrink-0">
          <div className="max-w-[1080px] mx-auto w-full space-x-6">
            {providers.map((provider) => {
              const Logo = provider.logo;
              return (
                <TabsTrigger
                  key={provider.id}
                  value={provider.id}
                  className="relative rounded-none border-b-2 border-transparent gap-1 pb-3 px-0 pt-0 text-sm font-normal text-neutral-500 dark:text-neutral-400 hover:text-black dark:hover:text-white data-[state=active]:border-black dark:data-[state=active]:border-white data-[state=active]:text-black dark:data-[state=active]:text-white data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent"
                >
                  {Logo && <Logo className="w-5 h-5" />}
                  {provider.displayName}
                </TabsTrigger>
              );
            })}
          </div>
        </TabsList>

        {/* Tab Content - Scrollbar on page edge */}
        <TabsContent value={activeTab} className="flex-1 min-h-0 overflow-y-auto mt-0">
          <div className="max-w-[1080px] mx-auto w-full pt-6 pb-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : modelsForActiveProvider.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-neutral-500 dark:text-neutral-400">
                No models available for{' '}
                {providers.find((p) => p.id === activeTab)?.displayName || activeTab}
              </div>
            ) : (
              <>
                {/* Table Header */}
                <div className="grid grid-cols-[200px_173px_173px_173px_173px_80px] gap-3 px-6 text-sm leading-6 text-neutral-500 dark:text-neutral-400 mb-2">
                  <div>Model</div>
                  <div>Input</div>
                  <button
                    onClick={() => handleSort('inputPrice')}
                    className="flex items-center gap-1 hover:text-black dark:hover:text-white transition-colors"
                  >
                    Input Price
                    <SortIndicator field="inputPrice" />
                  </button>
                  <div>Output</div>
                  <button
                    onClick={() => handleSort('outputPrice')}
                    className="flex items-center gap-1 hover:text-black dark:hover:text-white transition-colors"
                  >
                    Output Price
                    <SortIndicator field="outputPrice" />
                  </button>
                  <button
                    onClick={() => handleSort('requests')}
                    className="flex items-center gap-1 justify-end hover:text-black dark:hover:text-white transition-colors"
                  >
                    Requests
                    <SortIndicator field="requests" />
                  </button>
                </div>

                {/* Table Body */}
                {modelsForActiveProvider.map((model) => {
                  const isEnabled = configuredModelIds.includes(model.modelId);
                  const config = configurationMap.get(model.modelId);
                  const requests = config?.totalRequests || 0;

                  return (
                    <div
                      key={model.modelId}
                      className="grid grid-cols-[200px_173px_173px_173px_173px_80px] gap-3 px-6 py-4 items-center rounded-lg bg-neutral-100 dark:bg-[#323232] mb-3"
                    >
                      {/* Model with Toggle */}
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={() => handleSwitchChange(model.modelId, isEnabled)}
                        />
                        <span className="text-base font-medium text-black dark:text-white truncate">
                          {model.modelName}
                        </span>
                      </div>

                      {/* Input Modalities */}
                      <div className="text-sm leading-6 text-black dark:text-white">
                        {model.inputModality
                          .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
                          .join(' / ')}
                      </div>

                      {/* Input Price */}
                      <div className="text-sm text-black dark:text-white">
                        {formatPrice(model.inputPrice)}
                        {model.inputPrice && (
                          <span className="text-neutral-400 dark:text-neutral-500">
                            {' '}
                            / M tokens
                          </span>
                        )}
                      </div>

                      {/* Output Modalities */}
                      <div className="text-sm leading-6 text-black dark:text-white">
                        {model.outputModality
                          .map((m) => m.charAt(0).toUpperCase() + m.slice(1))
                          .join(' / ')}
                      </div>

                      {/* Output Price */}
                      <div className="text-sm text-black dark:text-white">
                        {formatPrice(model.outputPrice)}
                        {model.outputPrice && (
                          <span className="text-neutral-400 dark:text-neutral-500">
                            {' '}
                            / M tokens
                          </span>
                        )}
                      </div>

                      {/* Requests Count */}
                      <div className="text-right text-sm leading-6 text-black dark:text-white">
                        {requests > 0 ? requests.toLocaleString() : '-'}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Confirm Dialog */}
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
