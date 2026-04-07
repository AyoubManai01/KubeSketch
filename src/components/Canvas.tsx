import {
    applyNodeChanges,
    type Connection,
    type EdgeChange,
    ReactFlow,
    Background,
    Controls,
    BackgroundVariant,
    MarkerType,
    type NodeTypes,
    type NodeChange,
    type Node,
} from '@xyflow/react';
import { useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { useVeltraStore } from '../store/store';
import K8sNode from './K8sNode';
import { SUPPORTED_KINDS, type K8sResource, type SupportedKind } from '../types/types';
import type { K8sNodeData } from '../utils/buildGraph';

/** Register our custom node type so React Flow can render it */
const nodeTypes: NodeTypes = {
    k8sNode: K8sNode,
};

/**
 * React Flow canvas displaying K8s resource nodes.
 * Reads nodes/edges from the Zustand store.
 */
export default function Canvas() {
    const nodes = useVeltraStore((s) => s.nodes);
    const edges = useVeltraStore((s) => s.edges);
    const addNodeFromCanvas = useVeltraStore((s) => s.addNodeFromCanvas);
    const updateNodeFromCanvas = useVeltraStore((s) => s.updateNodeFromCanvas);
    const deleteNodeFromCanvas = useVeltraStore((s) => s.deleteNodeFromCanvas);
    const setCanvasNodes = useVeltraStore((s) => s.setCanvasNodes);
    const isBidirectionalSync = useVeltraStore((s) => s.isBidirectionalSync);
    const setSelectedResource = useVeltraStore((s) => s.setSelectedResource);
    const addCanvasEdge = useVeltraStore((s) => s.addCanvasEdge);
    const applyCanvasEdgeChanges = useVeltraStore((s) => s.applyCanvasEdgeChanges);
    const updateNodeResourceFromCanvas = useVeltraStore((s) => s.updateNodeResourceFromCanvas);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

    const selectedNode = useMemo(
        () => nodes.find((n) => n.id === selectedNodeId) ?? null,
        [nodes, selectedNodeId]
    );

    const onNodesChange = (changes: NodeChange[]) => {
        const nextNodes = applyNodeChanges(changes, nodes) as Node<K8sNodeData>[];
        setCanvasNodes(nextNodes);
    };
    const onEdgesChange = (changes: EdgeChange[]) => {
        applyCanvasEdgeChanges(changes);
    };
    const onConnect = (connection: Connection) => {
        addCanvasEdge(connection);
    };

    return (
        <div className="canvas-panel">
            <div className="panel-header">
                <span className="panel-header__dot" />
                <span className="panel-header__title">Resource Canvas</span>
            </div>
            <div className="canvas-toolbar">
                <div className="canvas-toolbar__group">
                    {SUPPORTED_KINDS.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            className="canvas-button"
                            onClick={() => addNodeFromCanvas(kind)}
                        >
                            + {kind}
                        </button>
                    ))}
                </div>
                <span className="canvas-toolbar__hint">
                    {isBidirectionalSync
                        ? 'Bidirectional mode: canvas edits update YAML'
                        : 'Canvas edits stay visual until bidirectional mode is enabled'}
                </span>
            </div>
            <div className="canvas-wrapper canvas-wrapper--split">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    defaultEdgeOptions={{
                        type: 'bezier',
                        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
                    }}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => {
                        setSelectedNodeId(node.id);
                        setSelectedResource({
                            kind: node.data.kind as SupportedKind,
                            name: node.data.name as string,
                        });
                    }}
                    fitView
                    fitViewOptions={{ padding: 0.55, maxZoom: 0.9 }}
                    proOptions={{ hideAttribution: true }}
                >
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={20}
                        size={1}
                        color="rgba(255, 255, 255, 0.05)"
                    />
                    <Controls
                        showInteractive={false}
                        className="canvas-controls"
                    />
                </ReactFlow>
                <aside className="node-inspector">
                    <div className="node-inspector__title">Node Inspector</div>
                    {!selectedNode && (
                        <div className="node-inspector__empty">
                            Click any node to edit its metadata.
                        </div>
                    )}
                    {selectedNode && (
                        <div className="node-inspector__form">
                            <label className="node-inspector__label">Kind</label>
                            <select
                                className="node-inspector__input"
                                value={selectedNode.data.kind as string}
                                onChange={(e) =>
                                    updateNodeFromCanvas(selectedNode.id, {
                                        kind: e.target.value as SupportedKind,
                                    })
                                }
                            >
                                {SUPPORTED_KINDS.map((kind) => (
                                    <option key={kind} value={kind}>
                                        {kind}
                                    </option>
                                ))}
                            </select>
                            <label className="node-inspector__label">Name</label>
                            <input
                                className="node-inspector__input"
                                value={(selectedNode.data.name as string) ?? ''}
                                onChange={(e) =>
                                    updateNodeFromCanvas(selectedNode.id, {
                                        name: e.target.value,
                                    })
                                }
                                placeholder="resource-name"
                            />
                            <label className="node-inspector__label">Namespace</label>
                            <input
                                className="node-inspector__input"
                                value={(selectedNode.data.namespace as string) ?? ''}
                                onChange={(e) =>
                                    updateNodeFromCanvas(selectedNode.id, {
                                        namespace: e.target.value,
                                    })
                                }
                                placeholder="default"
                            />
                            <label className="node-inspector__label">Labels (key=value, comma separated)</label>
                            <input
                                className="node-inspector__input"
                                value={toKeyValueString(selectedNode.data.resource.metadata?.labels)}
                                onChange={(e) =>
                                    updateResourceField(
                                        selectedNode.id,
                                        selectedNode.data.resource,
                                        updateNodeResourceFromCanvas,
                                        {
                                            metadata: {
                                                ...selectedNode.data.resource.metadata,
                                                labels: parseKeyValueString(e.target.value),
                                            },
                                        }
                                    )
                                }
                                placeholder="app=my-app,tier=frontend"
                            />
                            <label className="node-inspector__label">Annotations (key=value, comma separated)</label>
                            <input
                                className="node-inspector__input"
                                value={toKeyValueString(selectedNode.data.resource.metadata?.annotations as Record<string, string> | undefined)}
                                onChange={(e) =>
                                    updateResourceField(
                                        selectedNode.id,
                                        selectedNode.data.resource,
                                        updateNodeResourceFromCanvas,
                                        {
                                            metadata: {
                                                ...selectedNode.data.resource.metadata,
                                                annotations: parseKeyValueString(e.target.value),
                                            },
                                        }
                                    )
                                }
                                placeholder="owner=team-a"
                            />
                            {selectedNode.data.kind === 'Deployment' && (
                                <>
                                    <label className="node-inspector__label">Replicas</label>
                                    <input
                                        className="node-inspector__input"
                                        value={String((selectedNode.data.resource.spec as any)?.replicas ?? '')}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        replicas: toOptionalNumber(e.target.value),
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="3"
                                    />
                                    <label className="node-inspector__label">Selector Match Labels</label>
                                    <input
                                        className="node-inspector__input"
                                        value={toKeyValueString((selectedNode.data.resource.spec as any)?.selector?.matchLabels)}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        selector: {
                                                            ...((selectedNode.data.resource.spec as any)?.selector ?? {}),
                                                            matchLabels: parseKeyValueString(e.target.value),
                                                        },
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="app=my-app"
                                    />
                                </>
                            )}
                            {selectedNode.data.kind === 'ReplicaSet' && (
                                <>
                                    <label className="node-inspector__label">Replicas</label>
                                    <input
                                        className="node-inspector__input"
                                        value={String((selectedNode.data.resource.spec as any)?.replicas ?? '')}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        replicas: toOptionalNumber(e.target.value),
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="2"
                                    />
                                    <label className="node-inspector__label">Selector Match Labels</label>
                                    <input
                                        className="node-inspector__input"
                                        value={toKeyValueString((selectedNode.data.resource.spec as any)?.selector?.matchLabels)}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        selector: {
                                                            ...((selectedNode.data.resource.spec as any)?.selector ?? {}),
                                                            matchLabels: parseKeyValueString(e.target.value),
                                                        },
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="app=my-app"
                                    />
                                </>
                            )}
                            {selectedNode.data.kind === 'Pod' && (
                                <>
                                    <label className="node-inspector__label">Container Name</label>
                                    <input
                                        className="node-inspector__input"
                                        value={(selectedNode.data.resource.spec as any)?.containers?.[0]?.name ?? ''}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        containers: [
                                                            {
                                                                ...((selectedNode.data.resource.spec as any)?.containers?.[0] ?? {}),
                                                                name: e.target.value,
                                                            },
                                                        ],
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="app"
                                    />
                                    <label className="node-inspector__label">Container Image</label>
                                    <input
                                        className="node-inspector__input"
                                        value={(selectedNode.data.resource.spec as any)?.containers?.[0]?.image ?? ''}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        containers: [
                                                            {
                                                                ...((selectedNode.data.resource.spec as any)?.containers?.[0] ?? {}),
                                                                image: e.target.value,
                                                            },
                                                        ],
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="nginx:latest"
                                    />
                                </>
                            )}
                            {selectedNode.data.kind === 'Service' && (
                                <>
                                    <label className="node-inspector__label">Service Type</label>
                                    <input
                                        className="node-inspector__input"
                                        value={(selectedNode.data.resource.spec as any)?.type ?? ''}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        type: e.target.value,
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="ClusterIP"
                                    />
                                    <label className="node-inspector__label">Selector</label>
                                    <input
                                        className="node-inspector__input"
                                        value={toKeyValueString((selectedNode.data.resource.spec as any)?.selector)}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        selector: parseKeyValueString(e.target.value),
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="app=my-app"
                                    />
                                    <label className="node-inspector__label">Port</label>
                                    <input
                                        className="node-inspector__input"
                                        value={String((selectedNode.data.resource.spec as any)?.ports?.[0]?.port ?? '')}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        ports: [
                                                            {
                                                                ...((selectedNode.data.resource.spec as any)?.ports?.[0] ?? {}),
                                                                port: toOptionalNumber(e.target.value),
                                                            },
                                                        ],
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="80"
                                    />
                                </>
                            )}
                            {selectedNode.data.kind === 'Ingress' && (
                                <>
                                    <label className="node-inspector__label">Host</label>
                                    <input
                                        className="node-inspector__input"
                                        value={(selectedNode.data.resource.spec as any)?.rules?.[0]?.host ?? ''}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        rules: [
                                                            {
                                                                ...((selectedNode.data.resource.spec as any)?.rules?.[0] ?? {}),
                                                                host: e.target.value,
                                                            },
                                                        ],
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="my-app.example.com"
                                    />
                                    <label className="node-inspector__label">Path</label>
                                    <input
                                        className="node-inspector__input"
                                        value={(selectedNode.data.resource.spec as any)?.rules?.[0]?.http?.paths?.[0]?.path ?? ''}
                                        onChange={(e) =>
                                            updateResourceField(
                                                selectedNode.id,
                                                selectedNode.data.resource,
                                                updateNodeResourceFromCanvas,
                                                {
                                                    spec: {
                                                        ...(selectedNode.data.resource.spec as any),
                                                        rules: [
                                                            {
                                                                ...((selectedNode.data.resource.spec as any)?.rules?.[0] ?? {}),
                                                                http: {
                                                                    ...((selectedNode.data.resource.spec as any)?.rules?.[0]?.http ?? {}),
                                                                    paths: [
                                                                        {
                                                                            ...((selectedNode.data.resource.spec as any)?.rules?.[0]?.http?.paths?.[0] ?? {}),
                                                                            path: e.target.value,
                                                                        },
                                                                    ],
                                                                },
                                                            },
                                                        ],
                                                    },
                                                }
                                            )
                                        }
                                        placeholder="/"
                                    />
                                </>
                            )}
                            <button
                                type="button"
                                className="canvas-button canvas-button--danger"
                                onClick={() => {
                                    deleteNodeFromCanvas(selectedNode.id);
                                    setSelectedNodeId(null);
                                }}
                            >
                                Delete Node
                            </button>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}

function toOptionalNumber(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function parseKeyValueString(value: string): Record<string, string> | undefined {
    if (!value.trim()) return undefined;
    const pairs = value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const obj: Record<string, string> = {};
    pairs.forEach((pair) => {
        const [k, ...rest] = pair.split('=');
        if (!k || rest.length === 0) return;
        obj[k.trim()] = rest.join('=').trim();
    });
    return Object.keys(obj).length ? obj : undefined;
}

function toKeyValueString(value: Record<string, string> | undefined): string {
    if (!value) return '';
    return Object.entries(value)
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
}

function updateResourceField(
    nodeId: string,
    resource: K8sResource,
    updateFn: (nodeId: string, resource: K8sResource) => void,
    patch: Partial<K8sResource>
) {
    const merged: K8sResource = {
        ...resource,
        ...patch,
        metadata: {
            ...(resource.metadata ?? {}),
            ...(patch.metadata ?? {}),
        },
        spec: {
            ...(resource.spec as Record<string, unknown> | undefined),
            ...(patch.spec as Record<string, unknown> | undefined),
        },
    };
    updateFn(nodeId, merged);
}
