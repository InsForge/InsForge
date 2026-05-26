import { useState, useMemo, useEffect } from 'react';
import { Loader2, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { useAIModels } from '#features/ai/hooks/useAIModels';
import {
  Tabs,
  Tab,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@insforge/ui';
import { ErrorState } from '#components';
import {
  generateProviderTabs,
  filterModelsByProvider,
  getProviderDisplayOrder,
  getProviderIdFromModelId,
  getProviderLogo,
  toModelOption,
  type ModelOption,
  type SortField,
  type SortDirection,
} from '#features/ai/helpers';
import { ModelRow } from '#features/ai/components';
import { MODEL_MODALITY_FILTERS, type ModelModalityFilter } from '#features/ai/constants';

export default function AIModelsPage() {
  const { allAvailableModels, isLoadingModels, modelsError } = useAIModels();

  // Dynamically generate provider tabs from available models
  const providers = useMemo(() => generateProviderTabs(allAvailableModels), [allAvailableModels]);

  const [activeTab, setActiveTab] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField | null>('released');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [modalityFilter, setModalityFilter] = useState<ModelModalityFilter>('all');
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const providerIds = new Set(['all', ...providers.map((provider) => provider.id)]);
    if (!providerIds.has(activeTab)) {
      setActiveTab('all');
    }
  }, [providers, activeTab]);

  const modelsForActiveProvider = useMemo(() => {
    const models =
      activeTab === 'all'
        ? allAvailableModels.map(toModelOption)
        : filterModelsByProvider(allAvailableModels, activeTab).map(toModelOption);

    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filteredModels = models.filter((model) => {
      const matchesSearch =
        !normalizedSearch ||
        model.modelName.toLowerCase().includes(normalizedSearch) ||
        model.modelId.toLowerCase().includes(normalizedSearch) ||
        model.providerName.toLowerCase().includes(normalizedSearch);
      const matchesModality =
        modalityFilter === 'all' ||
        model.inputModality.some((modality) => modality === modalityFilter) ||
        model.outputModality.some((modality) => modality === modalityFilter);

      return matchesSearch && matchesModality;
    });

    return filteredModels.sort((a, b) => {
      const aProviderId = getProviderIdFromModelId(a.modelId);
      const bProviderId = getProviderIdFromModelId(b.modelId);
      const providerCompare =
        getProviderDisplayOrder(aProviderId) - getProviderDisplayOrder(bProviderId);
      if (providerCompare !== 0) {
        return providerCompare;
      }

      const providerNameCompare = a.providerName.localeCompare(b.providerName);
      if (providerNameCompare !== 0) {
        return providerNameCompare;
      }

      if (!sortField) {
        return a.modelName.localeCompare(b.modelName);
      }

      let aValue: number;
      let bValue: number;
      if (sortField === 'released') {
        aValue = a.created || 0;
        bValue = b.created || 0;
      } else if (sortField === 'inputPrice') {
        aValue = a.inputPrice || 0;
        bValue = b.inputPrice || 0;
      } else {
        aValue = a.outputPrice || 0;
        bValue = b.outputPrice || 0;
      }

      const valueCompare = sortDirection === 'desc' ? bValue - aValue : aValue - bValue;
      return valueCompare !== 0 ? valueCompare : a.modelName.localeCompare(b.modelName);
    });
  }, [allAvailableModels, activeTab, searchQuery, modalityFilter, sortField, sortDirection]);

  const modelGroups = useMemo(() => {
    const groups: { providerId: string; providerName: string; models: ModelOption[] }[] = [];
    for (const model of modelsForActiveProvider) {
      const providerId = getProviderIdFromModelId(model.modelId);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.providerId === providerId) {
        lastGroup.models.push(model);
      } else {
        groups.push({ providerId, providerName: model.providerName, models: [model] });
      }
    }
    return groups;
  }, [modelsForActiveProvider]);

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

  const isLoading = isLoadingModels;

  const toggleProviderCollapse = (providerId: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[rgb(var(--semantic-1))]">
      <div className="flex min-h-0 flex-1 justify-center px-10">
        <div className="flex min-h-0 w-full max-w-[1024px] flex-col py-10">
          <div className="flex shrink-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <h1 className="text-2xl font-medium leading-8 text-foreground">Models</h1>
              </div>
              <p className="text-sm leading-5 text-muted-foreground">
                Your models are ready — build LLM-powered features or add more integrations.
              </p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search Model"
                debounceTime={0}
                className="min-w-[280px] flex-1"
              />
              <Tabs
                value={modalityFilter}
                onValueChange={(value) => setModalityFilter(value as ModelModalityFilter)}
                className="h-8"
              >
                {MODEL_MODALITY_FILTERS.map((filter) => (
                  <Tab key={filter.id} value={filter.id} className="h-8 min-w-[66px]">
                    {filter.label}
                  </Tab>
                ))}
              </Tabs>
              <Select value={activeTab} onValueChange={setActiveTab}>
                <SelectTrigger className="w-[155px]">
                  <SelectValue placeholder="All Provider" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="all">All Provider</SelectItem>
                  {providers.map((provider) => {
                    const Logo = provider.logo;
                    return (
                      <SelectItem
                        key={provider.id}
                        value={provider.id}
                        icon={Logo ? <Logo /> : undefined}
                      >
                        {provider.displayName}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : modelsError ? (
              <ErrorState
                title="Failed to load models"
                error={modelsError}
                className="border-[var(--alpha-8)] bg-card"
              />
            ) : modelsForActiveProvider.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-muted-foreground">
                No models match the current filters.
              </div>
            ) : (
              <div className="flex max-h-full min-h-0 flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
                {/* Table Header - Fixed */}
                <div className="grid h-9 shrink-0 grid-cols-[149px_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_120px] items-center border-b border-[var(--alpha-8)] text-[13px] leading-[18px] text-muted-foreground">
                  <div className="flex h-full items-center border-r border-[var(--alpha-8)] px-2.5">
                    Model
                  </div>
                  <div className="px-2.5">Input</div>
                  <button
                    onClick={() => handleSort('inputPrice')}
                    className="group flex items-center gap-1 px-2.5 text-left transition-colors hover:text-foreground"
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
                  <div className="px-2.5">Output</div>
                  <button
                    onClick={() => handleSort('outputPrice')}
                    className="group flex items-center gap-1 px-2.5 text-left transition-colors hover:text-foreground"
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
                    onClick={() => handleSort('released')}
                    className="group flex items-center gap-1 px-2.5 text-left transition-colors hover:text-foreground"
                    aria-sort={
                      sortField === 'released'
                        ? sortDirection === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    Released
                    <SortIndicator field="released" />
                  </button>
                </div>

                {/* Table Body - Scrollable */}
                <div className="min-h-0 max-h-[calc(100%-36px)] overflow-y-auto">
                  {modelGroups.map((group) => {
                    const isCollapsed = collapsedProviders.has(group.providerId);
                    const ProviderLogo = getProviderLogo(group.providerId);

                    return (
                      <div key={group.providerId}>
                        {activeTab === 'all' && (
                          <button
                            type="button"
                            onClick={() => toggleProviderCollapse(group.providerId)}
                            className="flex h-10 w-full items-center gap-2 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-1))] px-2.5 text-left transition-colors hover:bg-[var(--alpha-4)]"
                            aria-expanded={!isCollapsed}
                          >
                            <ChevronDown
                              className={[
                                'size-4 shrink-0 text-muted-foreground transition-transform',
                                isCollapsed ? '-rotate-90' : '',
                              ].join(' ')}
                            />
                            {ProviderLogo && (
                              <ProviderLogo className="size-5 shrink-0 text-foreground" />
                            )}
                            <span className="text-[15px] font-medium leading-5 text-foreground">
                              {group.providerName}
                            </span>
                          </button>
                        )}
                        {(!isCollapsed || activeTab !== 'all') &&
                          group.models.map((model) => (
                            <ModelRow key={model.modelId} model={model} />
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
