import { create } from 'zustand';
import { applyEdgeChanges, type Connection, type EdgeChange, type Node, type Edge } from '@xyflow/react';
import { parseYaml } from '../utils/parseYaml';
import { buildGraph, nodeIdFor, type K8sNodeData } from '../utils/buildGraph';
import { resourcesToYaml } from '../utils/serializeYaml';
import { connectResources, explainInvalidLink } from '../utils/linkResources';
import type { SupportedKind, K8sResource } from '../types/types';

const YAML_KEY = 'veltra_yaml';
const USER_EDGES_KEY = 'veltra_user_edges';
const POSITIONS_KEY = 'veltra_node_positions';

/** Default YAML shown when the app first loads */
export const DEFAULT_YAML = `# Paste your Kubernetes YAML here (multi-document with ---)
# Recognized resources: Deployment, Service, Ingress, ReplicaSet, Pod
#
# Like a real cluster, Veltra materializes a Deployment's ReplicaSet and
# Pods on the canvas automatically — you only declare the Deployment.

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
  template:
    metadata:
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

export interface SelectedResource {
    kind: SupportedKind;
    name: string;
}

/** Transient feedback surfaced as a toast on the canvas (link results, guard rails). */
export interface CanvasNotice {
    id: number;
    tone: 'success' | 'error' | 'info';
    text: string;
}

let noticeSeq = 0;
const makeNotice = (tone: CanvasNotice['tone'], text: string): CanvasNotice => ({
    id: ++noticeSeq,
    tone,
    text,
});

interface VeltraState {
    /** Raw YAML string from the editor */
    yaml: string;

    /** React Flow nodes derived from the single resource model */
    nodes: Node<K8sNodeData>[];

    /** Edges inferred from the K8s model (selectors, ingress backends, …) */
    inferredEdges: Edge[];

    /** Cosmetic edges the user drew manually that have no K8s meaning */
    userEdges: Edge[];

    /** Merged edges rendered by React Flow (inferred + valid user edges) */
    edges: Edge[];

    /** Toggle that enables canvas -> YAML syncing */
    isBidirectionalSync: boolean;

    /** True when the canvas changed while sync was paused (YAML is stale) */
    canvasDirtyWhilePaused: boolean;

    /** Currently selected resource — single source of truth for editor highlight + inspector */
    selectedResource: SelectedResource | null;

    /** Syntax/validation error message if YAML parsing fails */
    yamlError: string | null;

    /** Latest transient feedback message (auto-dismissed by the canvas toast). */
    notice: CanvasNotice | null;

    setNotice: (notice: CanvasNotice | null) => void;
    setYaml: (value: string) => void;
    setBidirectionalSync: (enabled: boolean) => void;
    /** Structural node changes coming from React Flow (e.g. keyboard delete). */
    setCanvasNodes: (nodes: Node<K8sNodeData>[]) => void;
    /** Position/selection/dimension-only updates during drag — never touches the model or YAML. */
    setCanvasNodesPositionOnly: (nodes: Node<K8sNodeData>[]) => void;
    /** Persist the positions of user-dragged nodes to storage (called once on drag stop). */
    persistNodePositions: (draggedIds: string[]) => void;
    updateNodeFromCanvas: (
        nodeId: string,
        patch: Partial<Pick<K8sNodeData, 'kind' | 'name' | 'namespace'>>
    ) => void;
    deleteNodeFromCanvas: (nodeId: string) => void;
    setSelectedResource: (resource: SelectedResource | null) => void;
    addCanvasEdge: (connection: Connection) => void;
    applyCanvasEdgeChanges: (changes: EdgeChange[]) => void;
    updateNodeResourceFromCanvas: (nodeId: string, resource: K8sResource) => void;
    /** Add a fully configured resource (from the creation modal). */
    addConfiguredNode: (kind: SupportedKind, resource: K8sResource) => void;
    /** Discard manual positions and re-run automatic layout. */
    resetLayout: () => void;
    /** Clear the manifest, canvas, manual edges and saved layout. */
    clearAll: () => void;
}

export const useVeltraStore = create<VeltraState>((set, get) => {
    /** Rebuild nodes/edges from resources and merge in the user's manual edges. */
    const deriveGraph = (
        resources: K8sResource[],
        prevNodes: Node<K8sNodeData>[],
        userEdges: Edge[]
    ) => {
        const { nodes, edges: inferredEdges } = buildGraph(resources, prevNodes);
        return { nodes, inferredEdges, edges: mergeEdges(inferredEdges, userEdges, nodes) };
    };

    /**
     * Single commit path for every structural change coming from the canvas/inspector.
     * Rebuilds the graph, persists positions, and serializes YAML when sync is active.
     */
    const commitResources = (
        state: VeltraState,
        resources: K8sResource[],
        prevNodes: Node<K8sNodeData>[],
        opts: { userEdges?: Edge[]; selectedResource?: SelectedResource | null } = {}
    ): Partial<VeltraState> => {
        const userEdges = opts.userEdges ?? state.userEdges;
        if (opts.userEdges) {
            persistUserEdges(userEdges);
        }
        // Note: positions are only persisted when the user drags a node —
        // pinning auto-layout positions here would permanently disable
        // alignment and collision handling for every node after the first edit.
        const derived = deriveGraph(resources, prevNodes, userEdges);

        const result: Partial<VeltraState> = { ...derived, userEdges };
        if ('selectedResource' in opts) {
            result.selectedResource = opts.selectedResource ?? null;
        }

        if (state.isBidirectionalSync) {
            const nextYaml = resourcesToYaml(resources);
            localStorage.setItem(YAML_KEY, nextYaml);
            result.yaml = nextYaml;
            result.yamlError = null;
            result.canvasDirtyWhilePaused = false;
        } else {
            result.canvasDirtyWhilePaused = true;
        }
        return result;
    };

    // ── Initial load ──────────────────────────────────────────────────────
    const savedYaml = localStorage.getItem(YAML_KEY);
    const yamlVal = savedYaml !== null ? savedYaml : DEFAULT_YAML;
    const userEdgesVal = readUserEdges();

    let initialGraph = {
        nodes: [] as Node<K8sNodeData>[],
        inferredEdges: [] as Edge[],
        edges: [] as Edge[],
    };
    let initialError: string | null = null;

    try {
        const resources = parseYaml(yamlVal);
        initialGraph = deriveGraph(resources, [], userEdgesVal);
    } catch (e: any) {
        // Keep the editor content (with error surfaced) and an empty canvas —
        // never render a graph that doesn't correspond to the visible YAML.
        initialError = e.message || String(e);
    }

    return {
        yaml: yamlVal,
        nodes: initialGraph.nodes,
        inferredEdges: initialGraph.inferredEdges,
        edges: initialGraph.edges,
        userEdges: userEdgesVal,
        isBidirectionalSync: true,
        canvasDirtyWhilePaused: false,
        selectedResource: null,
        yamlError: initialError,
        notice: null,

        setNotice: (notice) => set({ notice }),

        setYaml: (value: string) => {
            localStorage.setItem(YAML_KEY, value);
            try {
                const resources = parseYaml(value);
                const state = get();
                const derived = deriveGraph(resources, state.nodes, state.userEdges);
                const sel = state.selectedResource;
                const selectionStillExists =
                    sel && derived.nodes.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);
                set({
                    yaml: value,
                    ...derived,
                    yamlError: null,
                    canvasDirtyWhilePaused: false,
                    selectedResource: selectionStillExists ? sel : null,
                });
            } catch (err: any) {
                // Graceful error: update raw text and store the error, but do NOT wipe/flicker the graph
                set({ yaml: value, yamlError: err.message || String(err) });
            }
        },

        setBidirectionalSync: (enabled: boolean) =>
            set((state) => {
                // Only rewrite YAML if the canvas actually diverged while sync was paused —
                // never clobber the user's hand-written YAML (comments, formatting) for nothing.
                if (enabled && state.canvasDirtyWhilePaused) {
                    const nextYaml = resourcesToYaml(toResources(state.nodes));
                    localStorage.setItem(YAML_KEY, nextYaml);
                    return {
                        isBidirectionalSync: true,
                        yaml: nextYaml,
                        yamlError: null,
                        canvasDirtyWhilePaused: false,
                    };
                }
                return { isBidirectionalSync: enabled };
            }),

        setCanvasNodes: (nodes: Node<K8sNodeData>[]) =>
            set((state) => {
                const removed = state.nodes.filter((n) => !nodes.some((m) => m.id === n.id));
                const removedIds = new Set(removed.map((n) => n.id));
                const userEdges = removedIds.size
                    ? state.userEdges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
                    : state.userEdges;
                const sel = state.selectedResource;
                const selectionRemoved =
                    sel && !nodes.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);
                const result = commitResources(state, toResources(nodes), nodes, {
                    userEdges,
                    selectedResource: selectionRemoved ? null : sel,
                });
                // Deleting a controller-managed resource behaves like a real cluster:
                // the commit re-materializes it from the owner's spec.
                const managed = removed.find((n) => n.data.synthetic);
                if (managed?.data.managedBy) {
                    result.notice = makeNotice(
                        'info',
                        `${managed.data.name} is managed by ${managed.data.managedBy.kind} ${managed.data.managedBy.name} — the controller recreated it. Delete the owner or lower its replicas instead.`
                    );
                }
                return result;
            }),

        setCanvasNodesPositionOnly: (nodes: Node<K8sNodeData>[]) => set({ nodes }),

        persistNodePositions: (draggedIds: string[]) => {
            const dragged = get().nodes.filter((n) => !n.parentId && draggedIds.includes(n.id));
            mergePositionsIntoStorage(dragged);
        },

        updateNodeFromCanvas: (nodeId, patch) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (!node) return {};
                if (node.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }

                const kind = (patch.kind ?? node.data.kind) as SupportedKind;
                const name = (patch.name ?? node.data.name).trim();
                const namespace = patch.namespace !== undefined ? patch.namespace : node.data.namespace;

                if (!name) return {}; // never allow a nameless resource
                const duplicate = state.nodes.some(
                    (n) => n.id !== nodeId && n.data.kind === kind && n.data.name === name
                );
                if (duplicate) return {}; // caller (inspector/modal) surfaces the error

                let updatedNodes = state.nodes.map((n) => {
                    if (n.id !== nodeId) return n;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            kind,
                            name,
                            namespace: namespace || undefined,
                            resource: {
                                ...n.data.resource,
                                apiVersion: apiVersionForKind(kind),
                                kind,
                                metadata: {
                                    ...(n.data.resource.metadata ?? {}),
                                    name,
                                    ...(namespace ? { namespace } : { namespace: undefined }),
                                },
                            },
                        },
                    };
                });

                // Cascade rename into name-based references (Ingress backends point at
                // Services by name; label selectors are unaffected by renames)
                if (node.data.kind === 'Service' && kind === 'Service' && name !== node.data.name) {
                    updatedNodes = renameServiceReferences(updatedNodes, node.data.name, name);
                }

                // Identity may have changed (kind/name are part of the node ID):
                // remap manual edges, migrate the saved position, and follow the selection.
                const newId = nodeIdFor(kind, name);
                let userEdges = state.userEdges;
                if (newId !== nodeId) {
                    userEdges = state.userEdges.map((e) => ({
                        ...e,
                        source: e.source === nodeId ? newId : e.source,
                        target: e.target === nodeId ? newId : e.target,
                    }));
                    persistUserEdges(userEdges);
                    renameStoredPosition(
                        `${node.data.kind}:${node.data.name}`,
                        `${kind}:${name}`
                    );
                }

                const sel = state.selectedResource;
                const wasSelected = sel && sel.kind === node.data.kind && sel.name === node.data.name;
                return commitResources(state, toResources(updatedNodes), updatedNodes, {
                    userEdges,
                    selectedResource: wasSelected ? { kind, name } : sel,
                });
            }),

        updateNodeResourceFromCanvas: (nodeId, resource) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (!node) return {};
                if (node.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }

                const kind = (resource.kind as SupportedKind) ?? node.data.kind;
                const name = resource.metadata?.name ?? node.data.name;

                const updatedNodes = state.nodes.map((n) => {
                    if (n.id !== nodeId) return n;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            resource,
                            kind,
                            name,
                            namespace: resource.metadata?.namespace,
                        },
                    };
                });

                const newId = nodeIdFor(kind, name);
                let userEdges = state.userEdges;
                if (newId !== nodeId) {
                    userEdges = state.userEdges.map((e) => ({
                        ...e,
                        source: e.source === nodeId ? newId : e.source,
                        target: e.target === nodeId ? newId : e.target,
                    }));
                    persistUserEdges(userEdges);
                    renameStoredPosition(`${node.data.kind}:${node.data.name}`, `${kind}:${name}`);
                }

                const sel = state.selectedResource;
                const wasSelected = sel && sel.kind === node.data.kind && sel.name === node.data.name;
                return commitResources(state, toResources(updatedNodes), updatedNodes, {
                    userEdges,
                    selectedResource: wasSelected ? { kind, name } : sel,
                });
            }),

        deleteNodeFromCanvas: (nodeId) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (node?.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }
                // Cascade like Kubernetes: deleting a controller removes what it owns.
                const doomed = collectWithDescendants(state.nodes, nodeId);
                if (doomed.size === 0) return {};

                const remaining = state.nodes.filter((n) => !doomed.has(n.id));
                const userEdges = state.userEdges.filter(
                    (e) => !doomed.has(e.source) && !doomed.has(e.target)
                );

                const sel = state.selectedResource;
                const selectionRemoved =
                    sel && !remaining.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);

                return commitResources(state, toResources(remaining), remaining, {
                    userEdges,
                    selectedResource: selectionRemoved ? null : sel,
                });
            }),

        setSelectedResource: (resource) => set({ selectedResource: resource }),

        addCanvasEdge: (connection) =>
            set((state) => {
                const { source, target } = connection;
                if (!source || !target || source === target) return {};

                // Connections to controller-managed resources are redirected to their real
                // owner — linking a Service to a materialized Pod means "select this
                // workload's pods", which lives on the workload's spec.
                const realNodes = state.nodes.filter((n) => !n.data.synthetic);
                const resolveReal = (id: string): Node<K8sNodeData> | null => {
                    const node = state.nodes.find((n) => n.id === id);
                    if (!node) return null;
                    if (!node.data.synthetic) return node;
                    const owner = node.data.managedBy;
                    if (!owner) return null;
                    return (
                        realNodes.find(
                            (n) => n.data.kind === owner.kind && n.data.name === owner.name
                        ) ?? null
                    );
                };

                const sourceNode = resolveReal(source);
                const targetNode = resolveReal(target);
                if (!sourceNode || !targetNode) return {};
                if (sourceNode.id === targetNode.id) {
                    return {
                        notice: makeNotice('info', 'Those resources already belong to the same workload.'),
                    };
                }

                // Already related? Check edges between the two resources *including* their
                // managed descendants (a Service selecting a Deployment's pods draws its
                // edges to the pod nodes), and existing containment.
                const sourceTree = collectWithDescendants(state.nodes, sourceNode.id);
                const targetTree = collectWithDescendants(state.nodes, targetNode.id);
                const alreadyLinked = state.edges.some(
                    (e) =>
                        (sourceTree.has(e.source) && targetTree.has(e.target)) ||
                        (targetTree.has(e.source) && sourceTree.has(e.target))
                );
                if (alreadyLinked) {
                    return {
                        notice: makeNotice(
                            'info',
                            `${sourceNode.data.name} and ${targetNode.data.name} are already connected.`
                        ),
                    };
                }
                if (
                    isAncestor(state.nodes, sourceNode.id, targetNode.id) ||
                    isAncestor(state.nodes, targetNode.id, sourceNode.id)
                ) {
                    return {
                        notice: makeNotice('info', 'That ownership already exists — it is shown as nesting.'),
                    };
                }

                // Express the link semantically in the K8s model (selector/labels/backend).
                // toResources drops synthetic nodes, so indices align with realNodes.
                const resources = toResources(state.nodes);
                const linked = connectResources(
                    resources,
                    realNodes.indexOf(sourceNode),
                    realNodes.indexOf(targetNode)
                );
                if (!linked) {
                    return {
                        notice: makeNotice(
                            'error',
                            explainInvalidLink(sourceNode.data.kind, targetNode.data.kind)
                        ),
                    };
                }
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    notice: makeNotice('success', linked.description),
                };
            }),

        applyCanvasEdgeChanges: (changes) =>
            set((state) => {
                // Removal only applies to manual edges; selection applies to both sets
                const userEdges = applyEdgeChanges(changes, state.userEdges);
                const selectChanges = changes.filter((c) => c.type === 'select');
                const inferredEdges = selectChanges.length
                    ? applyEdgeChanges(selectChanges, state.inferredEdges)
                    : state.inferredEdges;
                persistUserEdges(userEdges);
                return {
                    userEdges,
                    inferredEdges,
                    edges: mergeEdges(inferredEdges, userEdges, state.nodes),
                };
            }),

        addConfiguredNode: (kind: SupportedKind, resource: K8sResource) =>
            set((state) => {
                const name = resource.metadata?.name?.trim();
                if (!name) return {};
                if (state.nodes.some((n) => n.data.kind === kind && n.data.name === name)) {
                    return {}; // modal validates and surfaces this
                }
                // Let buildGraph auto-place the new resource (lane/cursor layout)
                const resources = [...toResources(state.nodes), resource];
                return commitResources(state, resources, state.nodes, {
                    selectedResource: { kind, name },
                });
            }),

        resetLayout: () => {
            localStorage.removeItem(POSITIONS_KEY);
            set((state) => {
                // Rebuild with no previous coordinates so every node returns to auto-layout
                return deriveGraph(toResources(state.nodes), [], state.userEdges);
            });
        },

        clearAll: () => {
            localStorage.setItem(YAML_KEY, '');
            localStorage.removeItem(POSITIONS_KEY);
            localStorage.removeItem(USER_EDGES_KEY);
            set({
                yaml: '',
                nodes: [],
                inferredEdges: [],
                edges: [],
                userEdges: [],
                selectedResource: null,
                yamlError: null,
                notice: null,
                canvasDirtyWhilePaused: false,
            });
        },
    };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Merge inferred edges with the user's manual edges.
 * Drops manual edges whose endpoints no longer exist and manual edges that
 * duplicate an inferred relationship (either direction).
 */
function mergeEdges(inferredEdges: Edge[], userEdges: Edge[], nodes: Node<K8sNodeData>[]): Edge[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const inferredPairs = new Set(inferredEdges.map((e) => `${e.source}->${e.target}`));
    const validUserEdges = userEdges.filter(
        (e) =>
            nodeIds.has(e.source) &&
            nodeIds.has(e.target) &&
            !inferredPairs.has(`${e.source}->${e.target}`) &&
            !inferredPairs.has(`${e.target}->${e.source}`)
    );
    return [...inferredEdges, ...validUserEdges];
}

/** Feedback shown when the user tries to mutate a controller-managed resource directly. */
function managedGuardNotice(node: Node<K8sNodeData>): CanvasNotice {
    const owner = node.data.managedBy;
    const ownerDesc = owner ? `${owner.kind} ${owner.name}` : 'its controller';
    return makeNotice(
        'info',
        `${node.data.name} is managed by ${ownerDesc} — edit or delete the owner instead (scale replicas to change pod count).`
    );
}

/**
 * The single conversion from render nodes back to the authoritative resource list.
 * Controller-materialized (synthetic) nodes are display-only and never serialized.
 */
function toResources(nodes: Node<K8sNodeData>[]): K8sResource[] {
    return nodes.filter((node) => !node.data.synthetic).map((node) => {
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
    if (kind === 'Deployment' || kind === 'ReplicaSet') return 'apps/v1';
    if (kind === 'Ingress') return 'networking.k8s.io/v1';
    return 'v1';
}

/** Rewrite Ingress backend references when a Service is renamed. */
function renameServiceReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Ingress') return n;
        const spec = n.data.resource.spec as {
            rules?: Array<{ http?: { paths?: Array<{ backend?: { service?: { name?: string } } }> } }>;
        } | undefined;
        const referencesService = spec?.rules?.some((rule) =>
            rule.http?.paths?.some((path) => path.backend?.service?.name === oldName)
        );
        if (!referencesService) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as NonNullable<typeof spec>;
        clonedSpec.rules?.forEach((rule) => {
            rule.http?.paths?.forEach((path) => {
                if (path.backend?.service?.name === oldName) {
                    path.backend.service.name = newName;
                }
            });
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Collect a node and all of its nested descendants (parentId chain). */
function collectWithDescendants(nodes: Node<K8sNodeData>[], rootId: string): Set<string> {
    const doomed = new Set<string>();
    if (!nodes.some((n) => n.id === rootId)) return doomed;
    doomed.add(rootId);
    let grew = true;
    while (grew) {
        grew = false;
        for (const n of nodes) {
            if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
                doomed.add(n.id);
                grew = true;
            }
        }
    }
    return doomed;
}

/** True if `ancestorId` contains `nodeId` somewhere up the parent chain. */
function isAncestor(nodes: Node<K8sNodeData>[], ancestorId: string, nodeId: string): boolean {
    let current = nodes.find((n) => n.id === nodeId);
    while (current?.parentId) {
        if (current.parentId === ancestorId) return true;
        current = nodes.find((n) => n.id === current!.parentId);
    }
    return false;
}

function readUserEdges(): Edge[] {
    try {
        const saved = localStorage.getItem(USER_EDGES_KEY);
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function persistUserEdges(edges: Edge[]) {
    try {
        // Strip transient UI state — a persisted `selected: true` would restore the
        // edge elevated above nodes on the next load and swallow their pointer events.
        const sanitized = edges.map((edge) => {
            const rest = { ...edge };
            delete rest.selected;
            return rest;
        });
        localStorage.setItem(USER_EDGES_KEY, JSON.stringify(sanitized));
    } catch (e) {
        console.error('Failed to save manual edges to storage', e);
    }
}

/** Merge the given nodes' positions into storage without touching other entries. */
function mergePositionsIntoStorage(nodes: Node<K8sNodeData>[]) {
    if (!nodes.length) return;
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        const positions: Record<string, { x: number; y: number }> = saved ? JSON.parse(saved) : {};
        nodes.forEach((node) => {
            positions[`${node.data.kind}:${node.data.name}`] = node.position;
        });
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch (e) {
        console.error('Failed to save positions to storage', e);
    }
}

function renameStoredPosition(oldKey: string, newKey: string) {
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        if (positions[oldKey]) {
            positions[newKey] = positions[oldKey];
            delete positions[oldKey];
            localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
        }
    } catch {}
}
