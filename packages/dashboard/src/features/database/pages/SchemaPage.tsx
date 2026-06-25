import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Node,
  BuiltInEdge,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Map, RefreshCw, Search } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@insforge/ui';
import { TableNode } from '#features/visualizer/components/TableNode';
import { VisualizerSkeleton } from '#features/visualizer/components/VisualizerSkeleton';
import { DatabaseSchemaSelect } from '#features/database/components/DatabaseSchemaSelect';
import { DatabaseStudioSidebarPanel } from '#features/database/components/DatabaseSidebar';
import { useDatabaseSchemaSelection } from '#features/database/hooks/useDatabaseSchemaSelection';
import { useDatabaseSchemas } from '#features/database/hooks/useDatabase';
import { useSchemaDiagram } from '#features/database/hooks/useTables';
import { useTheme } from '#lib/contexts/ThemeContext';
import { getDatabaseSchemaInfo } from '#features/database/helpers';
import { GetTableSchemaResponse } from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

type TableNodeData = {
  table: GetTableSchemaResponse;
  referencedColumns: string[];
  showRecordCount: boolean;
};

const NODE_WIDTH = 320;
const NODE_H_GAP = 80;
const NODE_V_GAP = 60;
const CANVAS_MARGIN = 40;

function calculateNodeHeight(columnCount: number): number {
  const headerHeight = 64;
  const columnHeight = 48;
  return headerHeight + (columnCount > 0 ? columnCount * columnHeight : 100);
}

function layoutGrid(tables: GetTableSchemaResponse[]): Node<TableNodeData>[] {
  const referencedByTable = buildReferencedColumns(tables);
  const cols = Math.max(1, Math.ceil(Math.sqrt(tables.length)));

  // Group into columns
  const columnGroups: GetTableSchemaResponse[][] = Array.from({ length: cols }, () => []);
  tables.forEach((t, i) => columnGroups[i % cols].push(t));

  const nodes: Node<TableNodeData>[] = [];

  columnGroups.forEach((group, colIdx) => {
    let y = CANVAS_MARGIN;
    group.forEach((table) => {
      nodes.push({
        id: table.tableName,
        type: 'tableNode',
        position: { x: CANVAS_MARGIN + colIdx * (NODE_WIDTH + NODE_H_GAP), y },
        data: {
          table,
          referencedColumns: referencedByTable[table.tableName] ?? [],
          showRecordCount: false,
        },
      });
      y += calculateNodeHeight(table.columns.length) + NODE_V_GAP;
    });
  });

  return nodes;
}

function buildReferencedColumns(tables: GetTableSchemaResponse[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  tables.forEach((t) => {
    t.columns.forEach((c) => {
      if (c.foreignKey) {
        const target = c.foreignKey.referenceTable;
        const col = c.foreignKey.referenceColumn;
        if (!map[target]) {
          map[target] = [];
        }
        if (!map[target].includes(col)) {
          map[target].push(col);
        }
      }
    });
  });
  return map;
}

function buildEdges(
  tables: GetTableSchemaResponse[],
  edgeColor: string,
  highlightedTable: string | null,
  connectedTables: Set<string> | null
): BuiltInEdge[] {
  const visibleTableNames = new Set(tables.map((t) => t.tableName));
  const edges: BuiltInEdge[] = [];
  tables.forEach((t) => {
    t.columns.forEach((c) => {
      if (!c.foreignKey) {
        return;
      }
      const target = c.foreignKey.referenceTable;
      if (!visibleTableNames.has(target)) {
        return;
      }
      const id = `${t.tableName}-${c.columnName}-${target}`;
      const isConnected =
        !highlightedTable ||
        !connectedTables ||
        (connectedTables.has(t.tableName) && connectedTables.has(target));

      edges.push({
        id,
        source: t.tableName,
        target,
        sourceHandle: `${c.columnName}-source`,
        targetHandle: `${c.foreignKey.referenceColumn}-target`,
        type: 'smoothstep',
        animated: isConnected,
        style: {
          stroke: edgeColor,
          strokeWidth: isConnected ? 2 : 1,
          opacity: highlightedTable && !isConnected ? 0.1 : 1,
          zIndex: 1000,
        },
        zIndex: 1000,
        pathOptions: { offset: 40 },
      });
    });
  });
  return edges;
}

// ---------------------------------------------------------------------------
// Inner canvas component (needs ReactFlowProvider context)
// ---------------------------------------------------------------------------

const nodeTypes = { tableNode: TableNode };

interface DiagramCanvasProps {
  tables: GetTableSchemaResponse[];
  showMinimap: boolean;
  highlightedTable: string | null;
  connectedTables: Set<string> | null;
  onNodeClick: NodeMouseHandler;
  onPaneClick: () => void;
}

function DiagramCanvas({
  tables,
  showMinimap,
  highlightedTable,
  connectedTables,
  onNodeClick,
  onPaneClick,
}: DiagramCanvasProps) {
  const { resolvedTheme } = useTheme();
  const edgeColor = resolvedTheme === 'dark' ? 'white' : '#18181b';

  const rawNodes = useMemo(() => layoutGrid(tables), [tables]);

  // Apply highlight opacity to nodes
  const styledNodes = useMemo(
    () =>
      rawNodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity: highlightedTable && connectedTables && !connectedTables.has(node.id) ? 0.2 : 1,
          transition: 'opacity 150ms ease',
        },
      })),
    [rawNodes, highlightedTable, connectedTables]
  );

  const rawEdges = useMemo(
    () => buildEdges(tables, edgeColor, highlightedTable, connectedTables),
    [tables, edgeColor, highlightedTable, connectedTables]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(styledNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  // Sync when data/highlight changes
  useEffect(() => {
    setNodes(styledNodes);
    setEdges(rawEdges);
  }, [styledNodes, rawEdges, setNodes, setEdges]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      connectionMode={ConnectionMode.Loose}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      elevateEdgesOnSelect
      colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
      className="!bg-transparent"
    >
      <Controls
        showInteractive={false}
        className="!border !border-border !shadow-md"
        fitViewOptions={{ padding: 0.15, duration: 300 }}
      />
      {showMinimap && (
        <MiniMap nodeColor={() => '#6ee7b7'} pannable zoomable className="!border !border-border" />
      )}
    </ReactFlow>
  );
}

// ---------------------------------------------------------------------------
// SchemaPage
// ---------------------------------------------------------------------------

function SchemaPageInner() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedSchema, setSelectedSchema } = useDatabaseSchemaSelection();
  const { schemas, isLoading: isLoadingSchemas } = useDatabaseSchemas();
  const selectedSchemaInfo = getDatabaseSchemaInfo(schemas, selectedSchema);

  const [searchQuery, setSearchQuery] = useState('');
  const [showMinimap, setShowMinimap] = useState(true);
  const [highlightedTable, setHighlightedTable] = useState<string | null>(null);

  const { tables, isLoading, error, refetch } = useSchemaDiagram(selectedSchema);

  // Filter tables by search query
  const visibleTables = useMemo(() => {
    if (!searchQuery.trim()) {
      return tables;
    }
    const q = searchQuery.toLowerCase();
    return tables.filter(
      (t) =>
        t.tableName.toLowerCase().includes(q) ||
        t.columns.some((c) => c.columnName.toLowerCase().includes(q))
    );
  }, [tables, searchQuery]);

  // Compute connected tables for highlight mode
  const connectedTables = useMemo<Set<string> | null>(() => {
    if (!highlightedTable) {
      return null;
    }
    const connected = new Set<string>([highlightedTable]);
    visibleTables.forEach((t) => {
      t.columns.forEach((c) => {
        if (c.foreignKey?.referenceTable === highlightedTable) {
          connected.add(t.tableName);
        }
        if (t.tableName === highlightedTable && c.foreignKey) {
          connected.add(c.foreignKey.referenceTable);
        }
      });
    });
    return connected;
  }, [highlightedTable, visibleTables]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setHighlightedTable((prev) => (prev === node.id ? null : node.id));
  }, []);

  const handlePaneClick = useCallback(() => {
    setHighlightedTable(null);
  }, []);

  // Reset highlight when schema or search changes
  useEffect(() => {
    setHighlightedTable(null);
  }, [selectedSchema, searchQuery]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <DatabaseStudioSidebarPanel
        onBack={() =>
          void navigate(
            { pathname: '/dashboard/database/tables', search: location.search },
            { state: { slideFromStudio: true } }
          )
        }
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-[rgb(var(--semantic-1))] px-3">
          {/* Schema selector */}
          <div className="w-44">
            <DatabaseSchemaSelect
              schemas={schemas}
              value={selectedSchemaInfo.name}
              onValueChange={(name) => {
                setSearchQuery('');
                setSelectedSchema(name, { replace: true });
              }}
              disabled={isLoadingSchemas}
            />
          </div>

          {/* Search */}
          <div className="relative w-52">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tables…"
              className="h-8 pl-7 text-sm"
            />
          </div>

          {/* Table count */}
          <span className="text-xs text-muted-foreground">
            {searchQuery && visibleTables.length !== tables.length
              ? `${visibleTables.length} / ${tables.length} tables`
              : `${tables.length} table${tables.length !== 1 ? 's' : ''}`}
          </span>

          <div className="flex-1" />

          <TooltipProvider>
            {/* Minimap toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showMinimap ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShowMinimap((v) => !v)}
                >
                  <Map className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {showMinimap ? 'Hide minimap' : 'Show minimap'}
              </TooltipContent>
            </Tooltip>

            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={isLoading}
                  onClick={() => void refetch()}
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Canvas */}
        <div className="relative min-h-0 flex-1">
          {/* Dot grid background */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40 dark:opacity-20"
            style={{
              backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              color: 'var(--muted-foreground)',
            }}
          />

          {isLoading ? (
            <VisualizerSkeleton />
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Failed to load schema. Check your connection and try refreshing.
            </div>
          ) : visibleTables.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {searchQuery ? 'No tables match your search.' : 'No tables found in this schema.'}
            </div>
          ) : (
            <DiagramCanvas
              tables={visibleTables}
              showMinimap={showMinimap}
              highlightedTable={highlightedTable}
              connectedTables={connectedTables}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
            />
          )}

          {/* Highlight hint */}
          {highlightedTable && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
              Showing relations for{' '}
              <span className="font-medium text-foreground">{highlightedTable}</span> — click table
              or canvas to clear
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SchemaPage() {
  return (
    <ReactFlowProvider>
      <SchemaPageInner />
    </ReactFlowProvider>
  );
}
