import { useCallback, useEffect, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  ConnectionMode,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { TableNode } from './TableNode';
import { DatabaseMetadata } from '@/features/metadata/services/metadata.service';
import dagre from 'dagre';

interface SchemaVisualizerProps {
  metadata: DatabaseMetadata;
}

const nodeTypes = {
  tableNode: TableNode,
};

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR', ranksep: 150, nodesep: 100 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 280, height: 200 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 140,
        y: nodeWithPosition.y - 100,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export function SchemaVisualizer({ metadata }: SchemaVisualizerProps) {
  const initialNodes = useMemo(() => {
    return metadata.tables.map((table, _) => ({
      id: table.tableName,
      type: 'tableNode',
      position: { x: 0, y: 0 }, // Will be calculated by dagre
      data: { table },
    }));
  }, [metadata]);

  const initialEdges = useMemo(() => {
    const edges: Edge[] = [];

    metadata.tables.forEach((table) => {
      table.columns.forEach((column) => {
        if (column.foreignKey) {
          const edgeId = `${table.tableName}-${column.columnName}-${column.foreignKey.referenceTable}`;
          edges.push({
            id: edgeId,
            source: table.tableName,
            target: column.foreignKey.referenceTable,
            sourceHandle: null,
            targetHandle: null,
            type: 'smoothstep',
            animated: true,
            label: column.columnName,
            labelStyle: { fontSize: 10, fontWeight: 500 },
            labelBgStyle: { fill: 'white', fillOpacity: 0.8 },
            style: { stroke: '#3B82F6', strokeWidth: 2 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#3B82F6',
            },
          });
        }
      });
    });

    return edges;
  }, [metadata]);

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(initialNodes, initialEdges),
    [initialNodes, initialEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges);

  useEffect(() => {
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

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
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} className="!bg-white !border-gray-200 !shadow-md" />
        <MiniMap
          nodeColor={() => '#3B82F6'}
          className="!bg-white !border-gray-200 !shadow-md"
          maskColor="rgb(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
}
