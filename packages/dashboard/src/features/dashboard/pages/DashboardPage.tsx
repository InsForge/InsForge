import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '@insforge/ui';
import { Skeleton } from '#components';
import {
  Braces,
  CheckCircle,
  Database,
  ExternalLink,
  HardDrive,
  Minus,
  Paperclip,
  Plus,
  Scan,
  User,
  Plug,
} from 'lucide-react';
import {
  Edge,
  Handle,
  Node,
  NodeProps,
  NodeTypes,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useApiKey, useMetadata } from '#lib/hooks/useMetadata';
import { useIsCloudHostingMode } from '#lib/config/DashboardHostContext';
import { useCloudProjectInfo } from '#lib/hooks/useCloudProjectInfo';
import { useMcpUsage } from '#features/logs/hooks/useMcpUsage';
import { getBackendUrl, isInsForgeCloudProject } from '#lib/utils/utils';
import { useUsers } from '#features/auth';
import { CLISection, MCPSection } from '#features/dashboard/components/connect';
import { useOpenConnectDialog } from '#layout/ConnectDialogContext';
import { ObservabilitySection } from '#features/dashboard/components/observability';
import { BackendAdvisorSection } from '#features/dashboard/components/advisor';
const REGION_COUNTRY_CODE_MAP: Record<string, 'us' | 'de' | 'sg'> = {
  'us-test': 'us',
  'us-east': 'us',
  'us-west': 'us',
  'eu-central': 'de',
  'ap-southeast': 'sg',
};
const PREVIEW_FIT_VIEW_OPTIONS = { padding: 0.6, maxZoom: 1.4, minZoom: 0.6 } as const;

type DatabasePreviewData = {
  tableCount: number;
  region?: string;
  showRegion: boolean;
  onOpenDatabase: () => void;
};

type AgentConnectorData = {
  onOpenConnect: () => void;
};

type AgentCardData = {
  requestCount: number;
};

type AgentConnectorNodeType = Node<AgentConnectorData, 'agentConnector'>;
type AgentCardNodeType = Node<AgentCardData, 'agentCard'>;
type DatabasePreviewNodeType = Node<DatabasePreviewData, 'databasePreview'>;
type PreviewNodeData = AgentConnectorNodeType | AgentCardNodeType | DatabasePreviewNodeType;

function getFlagUrlByRegion(region?: string): string | undefined {
  if (!region) {
    return undefined;
  }
  const countryCode = REGION_COUNTRY_CODE_MAP[region.toLowerCase()];
  if (!countryCode) {
    return undefined;
  }
  return `https://flagcdn.com/h20/${countryCode}.webp`;
}

function AgentConnectorNode({ data }: NodeProps<AgentConnectorNodeType>) {
  return (
    <button
      type="button"
      onClick={data.onOpenConnect}
      className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--alpha-8)] bg-card transition-colors hover:bg-[var(--alpha-4)]"
      aria-label="Connect agent"
    >
      <Plug className="h-5 w-5 text-muted-foreground" />
    </button>
  );
}

function AgentCardNode({ data }: NodeProps<AgentCardNodeType>) {
  const requestLabel = `${data.requestCount} MCP Call${data.requestCount === 1 ? '' : 's'}`;

  return (
    <div className="w-[240px] overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card shadow-[0px_4px_4px_rgba(0,0,0,0.08)]">
      <Handle
        type="source"
        position={Position.Right}
        id="edge-right"
        className="!h-0 !w-0 !border-0 !bg-transparent !opacity-0 !pointer-events-none"
        style={{ right: 0, top: '50%' }}
        isConnectable={false}
      />
      <div className="flex items-center gap-2 border-b border-[var(--alpha-8)] px-2 py-2">
        <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--alpha-8)] bg-semantic-1">
          <Paperclip className="h-5 w-5 text-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-5 text-foreground">Agent</p>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">
            {requestLabel}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3 py-3">
        <div className="h-2 w-2 rounded-full bg-primary" />
        <p className="text-sm leading-5 text-primary">Connected</p>
      </div>
    </div>
  );
}

function DatabasePreviewNode({ data }: NodeProps<DatabasePreviewNodeType>) {
  const tableLabel = `${data.tableCount} ${data.tableCount === 1 ? 'table' : 'tables'} created`;
  const flagUrl = getFlagUrlByRegion(data.region);
  const hasRegionRow = data.showRegion && !!data.region;

  return (
    <div className="w-[240px] overflow-hidden rounded-lg border border-[var(--alpha-8)] bg-card shadow-[0px_4px_4px_rgba(0,0,0,0.08)]">
      <Handle
        type="target"
        position={Position.Left}
        id="edge-left"
        className="!h-0 !w-0 !border-0 !bg-transparent !opacity-0 !pointer-events-none"
        style={{ left: 0, top: '50%' }}
        isConnectable={false}
      />
      <div
        className={`flex items-center gap-2 px-2 py-2 ${hasRegionRow ? 'border-b border-[var(--alpha-8)]' : ''}`}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--alpha-8)] bg-semantic-1">
          <Database className="h-5 w-5 text-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-5 text-foreground">Database</p>
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{tableLabel}</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={data.onOpenDatabase}
          className="size-5 rounded text-muted-foreground hover:text-foreground"
          aria-label="Open database tables"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      </div>

      {hasRegionRow && (
        <div className="flex items-center gap-2 px-3 py-3">
          {flagUrl && (
            <img
              src={flagUrl}
              alt=""
              className="h-3 w-[18px] rounded-[1px] border border-[var(--alpha-8)] object-cover"
            />
          )}
          <p className="truncate text-[13px] leading-[18px] text-muted-foreground">{data.region}</p>
        </div>
      )}
    </div>
  );
}

const previewNodeTypes = {
  agentConnector: AgentConnectorNode,
  agentCard: AgentCardNode,
  databasePreview: DatabasePreviewNode,
} satisfies NodeTypes;

function VisualizerControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="bottom-right" className="m-3">
      <div className="flex flex-col overflow-hidden rounded border border-[var(--alpha-8)] bg-card">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void zoomIn()}
          className="h-7 w-7 rounded-none border-b border-[var(--alpha-8)] text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground"
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void zoomOut()}
          className="h-7 w-7 rounded-none border-b border-[var(--alpha-8)] text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground"
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void fitView({ ...PREVIEW_FIT_VIEW_OPTIONS, duration: 250 })}
          className="h-7 w-7 rounded-none text-muted-foreground hover:bg-[var(--alpha-4)] hover:text-foreground"
          aria-label="Fit view"
        >
          <Scan className="h-4 w-4" />
        </Button>
      </div>
    </Panel>
  );
}

interface VisualizerAutoFitProps {
  fitVersion: number;
}

function VisualizerAutoFit({ fitVersion }: VisualizerAutoFitProps) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (fitVersion === 0) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      void fitView({ ...PREVIEW_FIT_VIEW_OPTIONS, duration: 250 });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [fitVersion, fitView]);

  return null;
}

interface StatusTileProps {
  label: string;
  value: string;
  icon: React.ReactNode;
}

function StatusTile({ label, value, icon }: StatusTileProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded border border-[var(--alpha-8)] bg-card">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs leading-4 text-muted-foreground">{label}</p>
        <p className="truncate text-base leading-7 text-foreground">{value}</p>
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  icon: React.ReactNode;
}

function MetricCard({ label, value, unit, icon }: MetricCardProps) {
  return (
    <div className="flex h-[120px] min-h-[120px] flex-col justify-between rounded border border-[var(--alpha-8)] bg-card p-4">
      <div className="flex h-[22px] items-center gap-1.5">
        <div className="flex h-5 w-5 items-center justify-center text-muted-foreground">{icon}</div>
        <p className="truncate text-[13px] leading-[22px] text-muted-foreground">{label}</p>
      </div>

      <p className="text-[20px] font-medium leading-7 text-foreground">
        {value}
        {unit && (
          <span className="ml-1 text-xs font-normal leading-4 text-muted-foreground">{unit}</span>
        )}
      </p>
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0">
      <div className="flex min-w-0 flex-col lg:flex-row">
        <section className="insforge-dashboard-home-sidebar min-w-0 shrink-0 border-b border-[var(--alpha-8)] px-10 py-10 lg:border-r lg:border-b-0">
          <div className="mx-auto flex w-full max-w-[400px] flex-col gap-12">
            <div className="flex flex-col gap-12">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-56" />
                <Skeleton className="h-5 w-16 rounded" />
              </div>
              <div className="flex gap-6">
                <div className="flex flex-1 items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
                <div className="flex flex-1 items-center gap-3">
                  <Skeleton className="h-12 w-12 rounded" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-[120px]" />
              <Skeleton className="h-[120px]" />
              <Skeleton className="h-[120px]" />
              <Skeleton className="h-[120px]" />
            </div>
          </div>
        </section>

        <section className="relative min-h-[420px] min-w-0 flex-1 overflow-hidden bg-semantic-0 lg:min-h-0">
          <div
            className="absolute inset-0 dark:hidden"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(0, 0, 0, 0.12) 1px, transparent 1px)`,
              backgroundSize: '34px 34px',
            }}
          />
          <div
            className="absolute inset-0 hidden dark:block"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255, 255, 255, 0.10) 1px, transparent 1px)`,
              backgroundSize: '34px 34px',
            }}
          />
          <div className="relative z-10 flex h-full items-center justify-center">
            <div className="flex items-center gap-12">
              <Skeleton className="h-[92px] w-[240px] rounded-lg border border-[var(--alpha-8)]" />
              <Skeleton className="h-[2px] w-[120px]" />
              <Skeleton className="h-[92px] w-[240px] rounded-lg border border-[var(--alpha-8)]" />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const openConnectDialog = useOpenConnectDialog();
  const isCloudHostingMode = useIsCloudHostingMode();
  const isCloudProject = isInsForgeCloudProject();
  const canShowCliGettingStarted = isCloudProject && isCloudHostingMode;
  const {
    metadata,
    tables,
    storage,
    isLoading: isMetadataLoading,
    error: metadataError,
  } = useMetadata();
  const { apiKey, isLoading: isApiKeyLoading } = useApiKey({ enabled: !canShowCliGettingStarted });
  const { projectInfo, isLoading: isProjectInfoLoading } = useCloudProjectInfo();
  const { totalUsers } = useUsers();
  const { hasCompletedOnboarding, recordsCount, isLoading: isMcpUsageLoading } = useMcpUsage();
  const [previewFitVersion, setPreviewFitVersion] = useState(0);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const appUrl = getBackendUrl();

  const tableCount = tables?.length ?? 0;
  const agentConnected = hasCompletedOnboarding;
  const shouldShowLoadingState =
    isMetadataLoading || isMcpUsageLoading || (isCloudProject && isProjectInfoLoading);
  const projectName = isCloudProject ? projectInfo.name : 'My InsForge Project';
  const instanceType = projectInfo.instanceType?.toUpperCase();
  const showInstanceTypeBadge = isCloudProject && !!instanceType;
  const showRegionInfo = isCloudProject && !!projectInfo.region;
  const projectRegion = projectInfo.region;
  const displayApiKey = isApiKeyLoading ? 'ik_' + '*'.repeat(32) : apiKey || '';

  const projectHealth = useMemo(() => {
    if (metadataError) {
      return 'Issue';
    }
    if (isMetadataLoading) {
      return 'Loading...';
    }
    return 'Healthy';
  }, [isMetadataLoading, metadataError]);

  const openConnectFlow = useCallback(() => {
    openConnectDialog();
  }, [openConnectDialog]);

  const initialPreviewNodes = useMemo<PreviewNodeData[]>(() => {
    const unconnectedPlugY = showRegionInfo ? 390 : 368;

    if (agentConnected) {
      return [
        {
          id: 'agent-card',
          type: 'agentCard',
          position: { x: 220, y: 360 },
          sourcePosition: Position.Right,
          data: {
            requestCount: recordsCount,
          },
        },
        {
          id: 'database',
          type: 'databasePreview',
          position: { x: 640, y: 360 },
          targetPosition: Position.Left,
          data: {
            tableCount,
            showRegion: showRegionInfo,
            region: projectRegion,
            onOpenDatabase: () => void navigate('/dashboard/database/tables'),
          },
        },
      ];
    }

    return [
      {
        id: 'agent-connector',
        type: 'agentConnector',
        position: { x: 552, y: unconnectedPlugY },
        data: {
          onOpenConnect: openConnectFlow,
        },
      },
      {
        id: 'database',
        type: 'databasePreview',
        position: { x: 640, y: 364 },
        data: {
          tableCount,
          showRegion: showRegionInfo,
          region: projectRegion,
          onOpenDatabase: () => void navigate('/dashboard/database/tables'),
        },
      },
    ];
  }, [
    agentConnected,
    openConnectFlow,
    recordsCount,
    tableCount,
    showRegionInfo,
    projectRegion,
    navigate,
  ]);

  const initialPreviewEdges = useMemo<Edge[]>(() => {
    if (!agentConnected) {
      return [];
    }

    return [
      {
        id: 'agent-to-database',
        source: 'agent-card',
        target: 'database',
        type: 'smoothstep',
        animated: true,
        sourceHandle: 'edge-right',
        targetHandle: 'edge-left',
        style: {
          stroke: 'white',
          strokeWidth: 2,
          zIndex: 1000,
        },
        zIndex: 1000,
      },
    ];
  }, [agentConnected]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialPreviewNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialPreviewEdges);

  useEffect(() => {
    setNodes(initialPreviewNodes);
    setEdges(initialPreviewEdges);
    setPreviewFitVersion((current) => current + 1);
  }, [initialPreviewNodes, initialPreviewEdges, setNodes, setEdges]);

  useEffect(() => {
    const previewContainer = previewContainerRef.current;
    if (!previewContainer || typeof ResizeObserver === 'undefined') {
      return;
    }

    let lastWidth = 0;
    let lastHeight = 0;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);
      if (nextWidth <= 0 || nextHeight <= 0) {
        return;
      }

      if (nextWidth === lastWidth && nextHeight === lastHeight) {
        return;
      }

      lastWidth = nextWidth;
      lastHeight = nextHeight;
      setPreviewFitVersion((current) => current + 1);
    });

    observer.observe(previewContainer);
    return () => observer.disconnect();
  }, []);

  if (shouldShowLoadingState) {
    return <DashboardLoadingState />;
  }

  return (
    <main
      className={`h-full min-h-0 min-w-0 overflow-y-auto bg-semantic-0${isCloudHostingMode ? '' : ' lg:overflow-hidden'}`}
    >
      <div
        className={`flex min-w-0 flex-col lg:flex-row${isCloudHostingMode ? '' : ' min-h-full lg:h-full lg:min-h-0'}`}
      >
        <section className="insforge-dashboard-home-sidebar min-w-0 shrink-0 border-b border-[var(--alpha-8)] px-10 py-10 lg:border-r lg:border-b-0">
          <div className="mx-auto flex w-full max-w-[400px] flex-col gap-12">
            <div className="flex flex-col gap-12">
              <div className="flex items-center gap-2">
                <h1 className="text-[32px] font-medium leading-8 text-foreground">{projectName}</h1>
                {showInstanceTypeBadge && (
                  <Badge
                    variant="default"
                    className="h-5 rounded px-2 py-0 text-xs font-medium uppercase text-muted-foreground"
                  >
                    {instanceType}
                  </Badge>
                )}
              </div>

              <div className="flex gap-6">
                <StatusTile
                  label="Status"
                  value={projectHealth}
                  icon={<div className="h-2 w-2 rounded-full bg-emerald-400" />}
                />
                <StatusTile
                  label="Agent"
                  value={agentConnected ? 'Connected' : 'Not Connected'}
                  icon={
                    agentConnected ? (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    ) : (
                      <Plug className="h-5 w-5 text-muted-foreground" />
                    )
                  }
                />
              </div>
            </div>

            {agentConnected ? (
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="User"
                  value={String(totalUsers ?? 0)}
                  icon={<User className="h-4 w-4" />}
                />
                <MetricCard
                  label="Database"
                  value={(metadata?.database.totalSizeInGB ?? 0).toFixed(2)}
                  unit="GB"
                  icon={<Database className="h-4 w-4" />}
                />
                <MetricCard
                  label="Storage"
                  value={(storage?.totalSizeInGB ?? 0).toFixed(2)}
                  unit="GB"
                  icon={<HardDrive className="h-4 w-4" />}
                />
                <MetricCard
                  label="Edge Functions"
                  value={String(metadata?.functions.length ?? 0)}
                  unit={(metadata?.functions.length ?? 0) === 1 ? 'Function' : 'Functions'}
                  icon={<Braces className="h-4 w-4" />}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-3">
                  <h2 className="text-base font-normal leading-7 text-foreground">
                    Getting Started
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {canShowCliGettingStarted
                      ? 'Run this command to link your agent to this project'
                      : 'Use MCP to link your agent to this project'}
                  </p>
                </div>

                {canShowCliGettingStarted ? (
                  <CLISection />
                ) : (
                  <MCPSection apiKey={displayApiKey} appUrl={appUrl} isLoading={isApiKeyLoading} />
                )}
              </div>
            )}
          </div>
        </section>

        <section className="relative min-h-[420px] min-w-0 flex-1 overflow-hidden bg-semantic-0 lg:min-h-0">
          <div
            className="absolute inset-0 dark:hidden"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(0, 0, 0, 0.12) 1px, transparent 1px)`,
              backgroundSize: '34px 34px',
            }}
          />
          <div
            className="absolute inset-0 hidden dark:block"
            style={{
              backgroundImage: `radial-gradient(circle, rgba(255, 255, 255, 0.10) 1px, transparent 1px)`,
              backgroundSize: '34px 34px',
            }}
          />

          <div ref={previewContainerRef} className="relative z-10 h-full w-full min-h-0 min-w-0">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={previewNodeTypes}
              fitView
              fitViewOptions={PREVIEW_FIT_VIEW_OPTIONS}
              minZoom={0.6}
              maxZoom={2}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              className="!bg-transparent"
            >
              <VisualizerAutoFit fitVersion={previewFitVersion} />
              <VisualizerControls />
            </ReactFlow>
          </div>
        </section>
      </div>
      {isCloudHostingMode && (
        <div className="flex flex-col gap-12 px-10 py-10">
          <ObservabilitySection />
          <BackendAdvisorSection />
        </div>
      )}
    </main>
  );
}
