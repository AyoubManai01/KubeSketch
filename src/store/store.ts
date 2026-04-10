import { create } from 'zustand';
import { addEdge, applyEdgeChanges, type Connection, type EdgeChange, type Node, type Edge } from '@xyflow/react';
import { parseYaml } from '../utils/parseYaml';
import { buildGraph, type K8sNodeData } from '../utils/buildGraph';
import { resourcesToYaml } from '../utils/serializeYaml';
import type { SupportedKind, K8sResource } from '../types/types';

/** Default YAML shown when the app first loads */
const DEFAULT_YAML = `# Paste your Kubernetes YAML here
# Supports multi-document YAML (---)
# Recognized resources: Deployment, Service, Ingress, ReplicaSet, Pod

apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
---
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: my-app-rs
  labels:
    app: my-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: my-app
---
apiVersion: v1
kind: Pod
metadata:
  name: my-app-pod
  labels:
    app: my-app
spec:
  containers:
    - name: app
      image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-svc
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
spec:
  rules:
    - host: my-app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-svc
                port:
                  number: 80
`;

interface VeltraState {
    /** Raw YAML string from the editor */
    yaml: string;

    /** React Flow nodes derived from the YAML */
    nodes: Node<K8sNodeData>[];

    /** React Flow edges (empty in MVP) */
    edges: Edge[];
    userEdges: Edge[];

    /** Toggle that enables canvas -> YAML syncing */
    isBidirectionalSync: boolean;
    selectedResource: { kind: SupportedKind; name: string } | null;

    /**
     * Update the YAML and re-derive the graph.
     * Called every time the editor content changes.
     */
    setYaml: (value: string) => void;
    setBidirectionalSync: (enabled: boolean) => void;
    setCanvasNodes: (nodes: Node<K8sNodeData>[]) => void;
    addNodeFromCanvas: (kind: SupportedKind) => void;
    updateNodeFromCanvas: (
        nodeId: string,
        patch: Partial<Pick<K8sNodeData, 'kind' | 'name' | 'namespace'>>
    ) => void;
    deleteNodeFromCanvas: (nodeId: string) => void;
    setSelectedResource: (resource: { kind: SupportedKind; name: string } | null) => void;
    addCanvasEdge: (connection: Connection) => void;
    applyCanvasEdgeChanges: (changes: EdgeChange[]) => void;
    updateNodeResourceFromCanvas: (nodeId: string, resource: K8sResource) => void;
}

export const useVeltraStore = create<VeltraState>((set, get) => {
    // Parse the default YAML to show initial nodes
    const initialResources = parseYaml(DEFAULT_YAML);
    const initialGraph = buildGraph(initialResources);

    return {
        yaml: DEFAULT_YAML,
        nodes: initialGraph.nodes,
        edges: initialGraph.edges,
        userEdges: [],
        isBidirectionalSync: true,
        selectedResource: null,

        setYaml: (value: string) => {
            const resources = parseYaml(value);
            const { nodes: parsedNodes, edges: inferredEdges } = buildGraph(resources);
            const nodes = preserveNodePositions(parsedNodes, get().nodes);
            const userEdges = get().userEdges;
            const edges = mergeInferredAndUserEdges(inferredEdges, userEdges, nodes);
            set({ yaml: value, nodes, edges });
        },
        setBidirectionalSync: (enabled: boolean) =>
            set((state) => ({
                isBidirectionalSync: enabled,
                yaml: enabled ? resourcesToYaml(toResources(state.nodes)) : state.yaml,
            })),
        setCanvasNodes: (nodes: Node<K8sNodeData>[]) =>
            set((state) => {
                const resources = toResources(nodes);
                const edges = mergeInferredAndUserEdges(buildGraph(resources).edges, state.userEdges, nodes);
                return {
                    nodes,
                    edges,
                    yaml: state.isBidirectionalSync ? resourcesToYaml(resources) : state.yaml,
                };
            }),
        addNodeFromCanvas: (kind: SupportedKind) =>
            set((state) => {
                const nodeName = generateUniqueName(kind, state.nodes);
                const newNode: Node<K8sNodeData> = {
                    id: `node-${Date.now()}-${Math.round(Math.random() * 10000)}`,
                    type: 'k8sNode',
                    position: { x: 120, y: 120 },
                    data: {
                        kind,
                        name: nodeName,
                        namespace: 'default',
                        resource: {
                            apiVersion: apiVersionForKind(kind),
                            kind,
                            metadata: { name: nodeName, namespace: 'default' },
                        },
                    },
                };
                const nodes = [...state.nodes, newNode];
                const resources = toResources(nodes);
                return {
                    nodes,
                    edges: mergeInferredAndUserEdges(buildGraph(resources).edges, state.userEdges, nodes),
                    yaml: state.isBidirectionalSync
                        ? resourcesToYaml(resources)
                        : state.yaml,
                };
            }),
        updateNodeFromCanvas: (nodeId, patch) =>
            set((state) => {
                const nodes = state.nodes.map((node) => {
                    if (node.id !== nodeId) return node;
                    const data = node.data as K8sNodeData;
                    const kind = (patch.kind ?? data.kind) as SupportedKind;
                    const name = patch.name ?? data.name;
                    const namespace = patch.namespace ?? data.namespace;
                    return {
                        ...node,
                        data: {
                            ...data,
                            kind,
                            name,
                            namespace,
                            resource: {
                                ...data.resource,
                                apiVersion: apiVersionForKind(kind),
                                kind,
                                metadata: {
                                    ...(data.resource.metadata ?? {}),
                                    name,
                                    ...(namespace ? { namespace } : { namespace: undefined }),
                                },
                            },
                        },
                    };
                });
                const resources = toResources(nodes);
                return {
                    nodes,
                    edges: mergeInferredAndUserEdges(buildGraph(resources).edges, state.userEdges, nodes),
                    yaml: state.isBidirectionalSync
                        ? resourcesToYaml(resources)
                        : state.yaml,
                };
            }),
        deleteNodeFromCanvas: (nodeId) =>
            set((state) => {
                const nodes = state.nodes.filter((node) => node.id !== nodeId);
                const resources = toResources(nodes);
                return {
                    nodes,
                    edges: mergeInferredAndUserEdges(buildGraph(resources).edges, state.userEdges, nodes),
                    yaml: state.isBidirectionalSync
                        ? resourcesToYaml(resources)
                        : state.yaml,
                };
            }),
        setSelectedResource: (resource) => set({ selectedResource: resource }),
        addCanvasEdge: (connection) =>
            set((state) => {
                const base: Edge = {
                    id: `manual-${Date.now()}-${Math.round(Math.random() * 10000)}`,
                    source: connection.source ?? '',
                    target: connection.target ?? '',
                    label: 'manual',
                    animated: true,
                    style: { stroke: '#a5c5f2', strokeWidth: 2.4 },
                };
                const userEdges = addEdge(base, state.userEdges);
                return {
                    userEdges,
                    edges: mergeInferredAndUserEdges(
                        buildGraph(toResources(state.nodes)).edges,
                        userEdges,
                        state.nodes
                    ),
                };
            }),
        applyCanvasEdgeChanges: (changes) =>
            set((state) => {
                const userEdges = applyEdgeChanges(changes, state.userEdges);
                return {
                    userEdges,
                    edges: mergeInferredAndUserEdges(
                        buildGraph(toResources(state.nodes)).edges,
                        userEdges,
                        state.nodes
                    ),
                };
            }),
        updateNodeResourceFromCanvas: (nodeId, resource) =>
            set((state) => {
                const nodes = state.nodes.map((node) => {
                    if (node.id !== nodeId) return node;
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            resource,
                            kind: resource.kind as SupportedKind,
                            name: resource.metadata?.name ?? node.data.name,
                            namespace: resource.metadata?.namespace,
                        },
                    };
                });
                const resources = toResources(nodes);
                return {
                    nodes,
                    edges: mergeInferredAndUserEdges(buildGraph(resources).edges, state.userEdges, nodes),
                    yaml: state.isBidirectionalSync ? resourcesToYaml(resources) : state.yaml,
                };
            }),
    };
});

function mergeInferredAndUserEdges(inferredEdges: Edge[], userEdges: Edge[], nodes: Node<K8sNodeData>[]): Edge[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validUserEdges = userEdges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
    );
    return [...inferredEdges, ...validUserEdges];
}

function preserveNodePositions(
    nextNodes: Node<K8sNodeData>[],
    previousNodes: Node<K8sNodeData>[]
): Node<K8sNodeData>[] {
    const previousByKey = new Map(
        previousNodes.map((node) => [resourceKey(node), node.position] as const)
    );
    return nextNodes.map((node) => {
        const position = previousByKey.get(resourceKey(node));
        return position ? { ...node, position } : node;
    });
}

function resourceKey(node: Node<K8sNodeData>): string {
    return `${node.data.kind}:${node.data.name}`;
}

function toResources(nodes: Node<K8sNodeData>[]): K8sResource[] {
    return nodes.map((node) => {
        const data = node.data;
        const metadataBase = data.resource?.metadata ?? {};
        const metadata = {
            ...metadataBase,
            name: data.name,
            ...(data.namespace ? { namespace: data.namespace } : {}),
        } as K8sResource['metadata'];
        if (!data.namespace && 'namespace' in metadata) {
            delete metadata.namespace;
        }
        return {
            ...data.resource,
            apiVersion: data.resource?.apiVersion ?? apiVersionForKind(data.kind as SupportedKind),
            kind: data.kind as SupportedKind,
            metadata,
        };
    });
}

function apiVersionForKind(kind: SupportedKind): string {
    if (kind === 'Deployment') return 'apps/v1';
    if (kind === 'Ingress') return 'networking.k8s.io/v1';
    return 'v1';
}

function generateUniqueName(kind: SupportedKind, nodes: Node<K8sNodeData>[]): string {
    const base = kind.toLowerCase();
    let index = 1;
    while (nodes.some((n) => (n.data as K8sNodeData).name === `${base}-${index}`)) {
        index += 1;
    }
    return `${base}-${index}`;
}
