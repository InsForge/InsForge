import { useCallback, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Node,
  BuiltInEdge,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { TableNode } from './TableNode';
import { AuthNode } from './AuthNode';
import { BucketNode } from './BucketNode';
import { useTables } from '@/features/database/hooks/useTables';
import {
  AppMetadataSchema,
  StorageBucketSchema,
  AuthMetadataSchema,
  GetTableSchemaResponse,
} from '@insforge/shared-schemas';

interface SchemaVisualizerProps {
  metadata: AppMetadataSchema;
  userCount?: number;
}

type TableNodeData = {
  table: GetTableSchemaResponse;
  referencedColumns: string[];
};

type BucketNodeData = {
  bucket: StorageBucketSchema;
};

type AuthNodeData = {
  authMetadata: AuthMetadataSchema;
  userCount?: number;
};

type CustomNodeData = TableNodeData | BucketNodeData | AuthNodeData;

const nodeTypes = {
  tableNode: TableNode,
  authNode: AuthNode,
  bucketNode: BucketNode,
};

const getLayoutedElements = (nodes: Node<CustomNodeData>[], edges: BuiltInEdge[]) => {
  // Fixed dimensions
  const nodeWidth = 280;

  // Calculate actual node heights based on content
  const calculateNodeHeight = (node: Node<CustomNodeData>) => {
    if (node.type === 'authNode') {
      // Auth node has fixed content
      return 150;
    } else if (node.type === 'tableNode') {
      // Table node height depends on columns
      const tableData = node.data as TableNodeData;
      const columnCount = tableData.table?.columns?.length || 0;
      const headerHeight = 64; // Header with table name
      const columnHeight = 48; // Each column row height
      const contentHeight = columnCount > 0 ? columnCount * columnHeight : 100; // Empty state height
      return headerHeight + contentHeight;
    } else if (node.type === 'bucketNode') {
      // Bucket node has relatively fixed height
      return 200;
    }
    return 200; // Default
  };

  // Layout parameters
  const horizontalGap = 100; // Gap between columns
  const verticalGap = 80; // Gap between nodes in same column
  const canvasMargin = 50;

  // Group nodes by type
  const authNodes = nodes.filter((node) => node.type === 'authNode');
  const tableNodes = nodes.filter((node) => node.type === 'tableNode');
  const bucketNodes = nodes.filter((node) => node.type === 'bucketNode');

  // Calculate column X positions
  const authX = canvasMargin;
  const tableStartX = authX + nodeWidth + horizontalGap * 2;
  const bucketX =
    tableStartX +
    Math.ceil(Math.sqrt(tableNodes.length)) * (nodeWidth + horizontalGap) +
    horizontalGap;

  // Helper function to distribute nodes vertically with dynamic heights
  const distributeVerticallyDynamic = (
    nodesToPosition: Node<CustomNodeData>[],
    startY: number = canvasMargin
  ) => {
    const positions: number[] = [];
    let currentY = startY;

    nodesToPosition.forEach((node) => {
      positions.push(currentY);
      const nodeHeight = calculateNodeHeight(node);
      currentY += nodeHeight + verticalGap;
    });

    return positions;
  };

  // Position auth nodes in left column
  const authYPositions = distributeVerticallyDynamic(authNodes);
  const positionedAuthNodes = authNodes.map((node, index) => ({
    ...node,
    position: {
      x: authX,
      y: authYPositions[index],
    },
  }));

  // Position table nodes in a grid in the middle
  let positionedTableNodes: Node<CustomNodeData>[] = [];
  if (tableNodes.length) {
    const cols = Math.ceil(Math.sqrt(tableNodes.length));

    // Group tables by column for better height calculation
    const tablesByColumn: Node<CustomNodeData>[][] = [];
    for (let col = 0; col < cols; col++) {
      tablesByColumn[col] = [];
    }

    tableNodes.forEach((node, index) => {
      const col = index % cols;
      tablesByColumn[col].push(node);
    });

    // Calculate Y positions for each column independently
    const columnYPositions: number[][] = tablesByColumn.map((columnNodes) =>
      distributeVerticallyDynamic(columnNodes)
    );

    positionedTableNodes = tableNodes.map((node, index) => {
      const col = index % cols;
      const rowInColumn = Math.floor(index / cols);

      return {
        ...node,
        position: {
          x: tableStartX + col * (nodeWidth + horizontalGap),
          y: columnYPositions[col][rowInColumn],
        },
      };
    });
  }

  // Position bucket nodes in right column
  const bucketYPositions = distributeVerticallyDynamic(bucketNodes);
  const positionedBucketNodes = bucketNodes.map((node, index) => ({
    ...node,
    position: {
      x: bucketX,
      y: bucketYPositions[index],
    },
  }));

  // Combine all positioned nodes
  const layoutedNodes = [...positionedAuthNodes, ...positionedTableNodes, ...positionedBucketNodes];

  return { nodes: layoutedNodes, edges };
};

const getNodeColor = (node: Node<CustomNodeData>) => {
  switch (node.type) {
    case 'authNode':
      return '#bef264';
    case 'bucketNode':
      return '#93c5fd';
    default:
      return '#6ee7b7';
  }
};

export function SchemaVisualizer({ metadata, userCount }: SchemaVisualizerProps) {
  // Fetch all table schemas
  const { allSchemas, isLoadingSchemas } = useTables();

  // Use the schemas from the hook instead of extracting from metadata
  const tables = allSchemas;

  const initialNodes = useMemo(() => {
    // First, collect all referenced columns for each table
    const referencedColumnsByTable: Record<string, string[]> = {};

    tables.forEach((table) => {
      table.columns.forEach((column) => {
        if (column.foreignKey) {
          const targetTable = column.foreignKey.referenceTable;
          const targetColumn = column.foreignKey.referenceColumn;

          if (!referencedColumnsByTable[targetTable]) {
            referencedColumnsByTable[targetTable] = [];
          }
          if (!referencedColumnsByTable[targetTable].includes(targetColumn)) {
            referencedColumnsByTable[targetTable].push(targetColumn);
          }
        }
      });
    });

    const tableNodes: Node<TableNodeData>[] = tables.map((table) => ({
      id: table.tableName,
      type: 'tableNode',
      position: { x: 0, y: 0 },
      data: {
        table,
        referencedColumns: referencedColumnsByTable[table.tableName] || [],
      },
    }));

    const bucketNodes: Node<BucketNodeData>[] = metadata.storage.buckets.map((bucket) => ({
      id: `bucket-${bucket.name}`,
      type: 'bucketNode',
      position: { x: 0, y: 0 },
      data: { bucket },
    }));

    const nodes: Node<CustomNodeData>[] = [...tableNodes, ...bucketNodes];

    // Add authentication node if authData is provided
    nodes.push({
      id: 'authentication',
      type: 'authNode',
      position: { x: 0, y: 0 },
      data: {
        authMetadata: metadata.auth,
        userCount,
      },
    });

    return nodes;
  }, [metadata, userCount, tables]);

  const initialEdges = useMemo(() => {
    const edges: BuiltInEdge[] = [];

    tables.forEach((table) => {
      table.columns.forEach((column) => {
        if (column.foreignKey) {
          const edgeId = `${table.tableName}-${column.columnName}-${column.foreignKey.referenceTable}`;
          edges.push({
            id: edgeId,
            source: table.tableName,
            target: column.foreignKey.referenceTable,
            sourceHandle: `${column.columnName}-source`,
            targetHandle: `${column.foreignKey.referenceColumn}-target`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: 'white', strokeWidth: 2, zIndex: 1000 },
            zIndex: 1000,
            pathOptions: {
              offset: 40,
            },
          });
        }
      });
    });

    // Add authentication edges if authData exists

    return edges;
  }, [tables]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(initialNodes, initialEdges),
    [initialNodes, initialEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    if (!isLoadingSchemas) {
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
    }
  }, [layoutedNodes, layoutedEdges, isLoadingSchemas, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  // Don't render ReactFlow until data is loaded
  if (isLoadingSchemas) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white">
        Loading schemas...
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 1, maxZoom: 2, minZoom: 1 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        elevateEdgesOnSelect={true}
        colorMode="dark"
        className="!bg-transparent"
      >
        <Controls
          showInteractive={false}
          className="!border !border-neutral-700 !shadow-lg"
          fitViewOptions={{ padding: 1, duration: 300, maxZoom: 2, minZoom: 1 }}
        />
        <MiniMap nodeColor={(node: Node<CustomNodeData>) => getNodeColor(node)} />
      </ReactFlow>
    </div>
  );
}
