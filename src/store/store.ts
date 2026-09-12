import { create } from 'zustand';
import { applyEdgeChanges, type Connection, type EdgeChange, type Node, type Edge } from '@xyflow/react';
import { parseYaml } from '../utils/parseYaml';
import {
    applyHpaReplicaOverrides,
    buildGraph,
    collectGatewayApiFamily,
    cronParallelismOf,
    daemonSetBoxPinKey,
    isDaemonSetSibling,
    isGatewayApiKind,
    isRouteKind,
    isSingleNodeAccessMode,
    nodeIdFor,
    parallelismOf,
    replicasOf,
    type HpaReplicaOverride,
    type K8sNodeData,
} from '../utils/buildGraph';
import { resourcesToYaml } from '../utils/serializeYaml';
import {
    connectResources,
    explainInvalidLink,
    linkConfigMapToWorkload,
    linkPvcToWorkload,
    linkSecretToWorkload,
    linkIngressToSecret,
    type ConfigMapMechanism,
    type SecretMechanism,
} from '../utils/linkResources';
import { isClusterScoped } from '../utils/k8sScope';
import { computeFileOf, fileViewOf, resourceKeyOf } from '../utils/fileTree';
import { repairPlacements, placeNewNamespaceRect, placeNewNodeRect, tileNodesOverNamespace } from '../utils/placement';
import {
    buildTeachingFrame,
    clampRectToRect,
    DEFAULT_CLUSTER_RECT,
    FALLBACK_NODE_HEIGHT,
    FALLBACK_NODE_WIDTH,
    NAMESPACE_MIN_RECT,
    NODE_MIN_RECT,
    PROTECTED_NAMESPACES,
    rectContainsRect,
    rectsOverlap,
    resolveMoveCollision,
    resolveResizeCollision,
    type NamespaceRect,
    type NsLayout,
    type Rect,
} from '../utils/teachingFrame';
import type { SupportedKind, K8sResource } from '../types/types';

const YAML_KEY = 'veltra_yaml';
const USER_EDGES_KEY = 'veltra_user_edges';
const POSITIONS_KEY = 'veltra_node_positions';
const NS_LAYOUT_KEY = 'veltra_ns_layout';
const FILE_EXPLORER_KEY = 'veltra_file_explorer';
const ACTIVE_FILE_KEY = 'veltra_active_file';

/** Default YAML shown when the app first loads */
export const DEFAULT_YAML = `# Paste your Kubernetes YAML here (multi-document with ---)
# Recognized resources: Deployment, DaemonSet, Service, Ingress, ReplicaSet, Pod, HorizontalPodAutoscaler,
# ConfigMap, PersistentVolumeClaim, PersistentVolume, StorageClass, Secret, Job,
# CronJob, VerticalPodAutoscaler, GatewayClass, Gateway, HTTPRoute, GRPCRoute,
# TCPRoute, TLSRoute, UDPRoute
#
# Like a real cluster, Veltra materializes a Deployment's ReplicaSet and
# Pods on the canvas automatically — you only declare the Deployment.
# A DaemonSet places one Pod on every node its namespace covers — each Pod
# renders inside its own DaemonSet box on that node.
# A CronJob's Job (and its Pods) are materialized the same way.

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
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
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

/**
 * A ConfigMap → workload canvas drag waiting for the user to pick the consumption
 * mechanism (envFrom / volumes / env-key) in the post-drag prompt. Both resources
 * are REAL (synthetic targets are resolved to their owner before this is set).
 */
export interface PendingConfigMapLink {
    cm: { name: string };
    target: { kind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/** Target + mechanism for writing a ConfigMap reference (create-modal path). */
export interface ConfigMapLinkPayload {
    targetKind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob';
    targetName: string;
    mechanism: ConfigMapMechanism;
    key?: string;
}

/**
 * A Secret → workload canvas drag waiting for the user to pick the consumption
 * mechanism (envFrom / volumes / env-key) in the post-drag prompt. Both resources
 * are REAL (synthetic targets are resolved to their owner before this is set).
 */
export interface PendingSecretLink {
    secret: { name: string };
    target: { kind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/** Target + mechanism for writing a Secret reference (create-modal path). */
export interface SecretLinkPayload {
    targetKind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob';
    targetName: string;
    mechanism: SecretMechanism;
    key?: string;
    volumeName?: string;
}

/**
 * An Ingress → Secret canvas drag waiting for the user to confirm the TLS hosts
 * in the post-drag prompt. Both resources are REAL.
 */
export interface PendingIngressTlsLink {
    ingress: { name: string };
    secret: { name: string };
}

/** TLS hosts + Secret for a newly created Ingress (create-modal path). */
export interface IngressTlsPayload {
    secretName: string;
    hosts: string[];
}

/**
 * A PVC → Pod/Deployment/ReplicaSet canvas drag waiting for the user to pick the
 * volume name in the post-drag prompt. Both resources are REAL (synthetic targets
 * resolve to their owner first). A single-node access mode (ReadWriteOnce /
 * ReadWriteOncePod) is rejected before the prompt when the workload runs more
 * than one replica — identical Pods cannot share a single-node claim.
 */
export interface PendingPvcLink {
    pvc: { name: string };
    target: { kind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/**
 * Optional links for a newly created PVC (create-modal path): a mount target — a
 * Pod, Deployment or ReplicaSet to claim it from (with the volume name; workloads
 * get the reference in their Pod template) — and exactly one bind target, a PV or
 * a StorageClass. Setting one bind kind clears the other field on the PVC.
 */
export interface PvcLinkPayload {
    mountTarget?: { kind: 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string; volumeName: string };
    bindTarget?: { kind: 'PersistentVolume' | 'StorageClass'; name: string };
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

    /** Currently selected resource — single source of truth for editor highlight + inspector */
    selectedResource: SelectedResource | null;

    /** Syntax/validation error message if YAML parsing fails */
    yamlError: string | null;

    /** Latest transient feedback message (auto-dismissed by the canvas toast). */
    notice: CanvasNotice | null;

    /** Active HorizontalPodAutoscaler replica clamps from the last commit — drives the bottom status bar. */
    hpaOverrides: HpaReplicaOverride[];

    /** A ConfigMap→workload drag awaiting the mechanism choice in the post-drag prompt. */
    pendingConfigMapLink: PendingConfigMapLink | null;

    /** A PVC→Pod drag awaiting the volume name in the post-drag prompt. */
    pendingPvcLink: PendingPvcLink | null;

    /** A Secret→workload drag awaiting the mechanism choice in the post-drag prompt. */
    pendingSecretLink: PendingSecretLink | null;

    /** An Ingress→Secret drag awaiting the TLS hosts in the post-drag prompt. */
    pendingIngressTlsLink: PendingIngressTlsLink | null;

    /** Namespace editing mode: namespace/cluster rectangles become draggable,
     *  resizeable and addable; resources are fixed in place (group-moved with
     *  their rectangle) and can be dragged onto another rectangle to reassign. */
    nsEditMode: boolean;

    /** Dedicated physical-node editing mode: node/cluster rectangles become
     *  draggable, resizeable and addable (namespaces stay decorative). Mutually
     *  exclusive with `nsEditMode` — entering one exits the other. */
    nodeEditMode: boolean;

    /** Cluster + namespace rectangles (positions/sizes). Null until the user
     *  edits them — the rendered layout then derives from the live graph every
     *  time. Persisted on exit of namespace editing. */
    nsLayout: NsLayout | null;

    /** VSCode-style file explorer mode: the editor pane becomes an explorer
     *  sidebar + a per-file editor (a projection of the single YAML manifest). */
    fileExplorerMode: boolean;

    /** The active virtual file path (e.g. `default/my-app/deployment.yaml`). */
    activeFile: string | null;

    /** Raw editor text of the active file — the file view is a scoped editor, so
     *  unlike `yaml` this is only re-serialized when the model changes externally. */
    activeFileText: string;

    /** Syntax/validation error from the scoped file editor (invalid YAML keeps
     *  the last good model and the canvas untouched). */
    fileYamlError: string | null;

    setNotice: (notice: CanvasNotice | null) => void;
    setYaml: (value: string) => void;
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
    addConfiguredNode: (
        kind: SupportedKind,
        resource: K8sResource,
        link?: ConfigMapLinkPayload | PvcLinkPayload | SecretLinkPayload | IngressTlsPayload,
        opts?: { desiredNodes?: number }
    ) => void;
    /** Add a batch of fully configured, already cross-referenced resources in a
     *  single commit (Gateway API bundles from the combined creation modal). */
    addConfiguredNodes: (resources: K8sResource[], selectedResource?: SelectedResource) => void;
    /** Surface the mechanism prompt after a ConfigMap→workload drag (or dismiss it). */
    setPendingConfigMapLink: (link: PendingConfigMapLink | null) => void;
    /** Commit the pending ConfigMap link with the chosen mechanism. */
    confirmConfigMapLink: (mechanism: ConfigMapMechanism, key?: string) => void;
    cancelConfigMapLink: () => void;
    /** Surface the volume-name prompt after a PVC→Pod drag (or dismiss it). */
    setPendingPvcLink: (link: PendingPvcLink | null) => void;
    /** Commit the pending PVC→Pod link with the chosen volume name. */
    confirmPvcLink: (volumeName: string) => void;
    cancelPvcLink: () => void;
    /** Surface the mechanism prompt after a Secret→workload drag (or dismiss it). */
    setPendingSecretLink: (link: PendingSecretLink | null) => void;
    /** Commit the pending Secret link with the chosen mechanism (and optional key/volume name). */
    confirmSecretLink: (mechanism: SecretMechanism, key?: string, volumeName?: string) => void;
    cancelSecretLink: () => void;
    /** Surface the hosts prompt after an Ingress→Secret drag (or dismiss it). */
    setPendingIngressTlsLink: (link: PendingIngressTlsLink | null) => void;
    /** Commit the pending Ingress TLS link with the chosen hosts. */
    confirmIngressTlsLink: (hosts: string[]) => void;
    cancelIngressTlsLink: () => void;
    /** Discard manual positions and re-run automatic layout. */
    resetLayout: () => void;
    /** Clear the manifest, canvas, manual edges and saved layout. */
    clearAll: () => void;
    /** Enter/exit namespace editing mode; exiting persists the layout. */
    setNsEditMode: (on: boolean) => void;
    /** Enter/exit the dedicated physical-node editing mode; exiting persists the
     *  layout. Entering either frame mode exits the other (they share one layout). */
    setNodeEditMode: (on: boolean) => void;
    /** Move a namespace rectangle (and every contained top-level node with it).
     *  The node translation is derived by diffing `rect` against the current
     *  rectangle, so callers may pass absolute (drag-start-anchored) rects. */
    moveNamespace: (name: string, rect: Rect) => void;
    /** Move the cluster rectangle, all namespace rectangles and every top-level
     *  node with it (translation derived from the rect diff). */
    moveClusterRect: (cluster: Rect) => void;
    /** Resize a namespace rectangle (no node movement). */
    resizeNsRect: (name: string, rect: Rect) => void;
    /** Resize the cluster rectangle (no node movement). */
    resizeClusterRect: (rect: Rect) => void;
    /** Add an empty namespace rectangle with the given position/size. */
    addNamespace: (name: string, rect?: Rect) => void;
    /** Delete a namespace: removes its rectangle and cascade-deletes every
     *  resource living in it (K8s-style). `default` is protected. */
    deleteNamespace: (name: string) => void;
    /** Move a physical node rectangle (and every namespace rectangle fully
     *  contained in it, with their resources). Straddling namespaces stay put —
     *  they belong to other nodes too. Translation derived from the rect diff. */
    moveNodeRect: (name: string, rect: Rect) => void;
    /** Resize a physical node rectangle (no namespace/resource movement).
     *  Growth stops at sibling node rects; a shrink can't evict a namespace
     *  rectangle it fully contains. */
    resizeNodeRect: (name: string, rect: Rect) => void;
    /** Add an empty physical node rectangle (swept into the first free pocket;
     *  the cluster grows when there is no room). */
    addNode: (name: string, rect?: Rect) => void;
    /** Delete a physical node rectangle. Namespaces/resources are untouched —
     *  nodes are canvas-only chrome that never own resources. */
    deleteNode: (name: string) => void;
    /** Re-derive the graph from the current layout (DaemonSet boxes/pod counts
     *  follow node/namespace rect edits). Never touches YAML. */
    refreshLayoutDerived: () => void;
    /** Enter/exit VSCode-style file explorer mode (persisted). Entering picks a
     *  sensible active file (the selected resource's, else the first one). */
    setFileExplorerMode: (on: boolean) => void;
    /** Open a virtual file in the scoped editor (validated against the live tree). */
    setActiveFile: (path: string | null) => void;
    /** Scoped editor commit: re-parse just this file's slice, merge it back into
     *  the single manifest and rebuild the graph via commitResources. Invalid
     *  YAML sets `fileYamlError` and never touches the model/canvas. */
    setFileYaml: (path: string, value: string) => void;
}

export const useVeltraStore = create<VeltraState>((set, get) => {
    /** Rebuild nodes/edges from resources and merge in the user's manual edges.
     *  Auto-placed nodes are then repaired into their namespace/cluster boxes,
     *  overlap-free, growing persisted boxes when they don't fit. */
    const deriveGraph = (
        resources: K8sResource[],
        prevNodes: Node<K8sNodeData>[],
        userEdges: Edge[],
        nsLayout: NsLayout | null
    ) => {
        // The persisted layout drives DaemonSet materialization: one box+Pod per
        // physical node rect the DaemonSet's namespace straddles.
        const { nodes, edges: inferredEdges, autoPlacedIds } = buildGraph(
            resources,
            prevNodes,
            nsLayout
        );
        const placed = repairPlacements(nodes, autoPlacedIds, nsLayout);
        return {
            nodes: placed.nodes,
            inferredEdges,
            edges: mergeEdges(inferredEdges, userEdges, placed.nodes),
            ...(placed.layoutChanged ? { nsLayout: placed.nsLayout } : {}),
            layoutChanged: placed.layoutChanged,
        };
    };

    /**
     * Single commit path for every structural change coming from the canvas/inspector.
     * Rebuilds the graph, persists positions, and serializes YAML when sync is active.
     */
    const commitResources = (
        state: VeltraState,
        resources: K8sResource[],
        prevNodes: Node<K8sNodeData>[],
        opts: { userEdges?: Edge[]; selectedResource?: SelectedResource | null; nsLayout?: NsLayout | null } = {}
    ): Partial<VeltraState> => {
        const userEdges = opts.userEdges ?? state.userEdges;
        if (opts.userEdges) {
            persistUserEdges(userEdges);
        }
        // HorizontalPodAutoscaler priority: clamp each targeted workload's spec.replicas into the autoscaler's
        // [minReplicas, maxReplicas] window and write the clamped value back, so the
        // derived graph, the YAML serialization and the badges all agree.
        const hpaOverrides = applyHpaReplicaOverrides(resources);
        // Note: positions are only persisted when the user drags a node —
        // pinning auto-layout positions here would permanently disable
        // alignment and collision handling for every node after the first edit.
        // DaemonSet creation may have created new physical node rects first —
        // the caller can pass the grown layout so this commit's buildGraph
        // materializes the DaemonSet's per-node Pods immediately.
        const nsLayout = opts.nsLayout ?? state.nsLayout;
        const derived = deriveGraph(resources, prevNodes, userEdges, nsLayout);
        // A repair that grew a persisted namespace/cluster box is written back so
        // NS-mode edits start from the grown layout (auto layouts stay null).
        const { layoutChanged, ...derivedRest } = derived;
        if (layoutChanged && derived.nsLayout) {
            persistNsLayout(derived.nsLayout);
        }

        const result: Partial<VeltraState> = { ...derivedRest, userEdges, hpaOverrides };
        // DaemonSet creation may have created new node rects first: surface them in
        // state even when the repair pass didn't need to grow anything (otherwise
        // a fresh auto layout would stay null and the node rects would not render).
        if (opts.nsLayout) {
            result.nsLayout = derived.nsLayout ?? opts.nsLayout;
        }
        if ('selectedResource' in opts) {
            result.selectedResource = opts.selectedResource ?? null;
        }
        // The file-explorer view follows external model changes (canvas/inspector
        // commits): re-validate the active file against the new tree and re-serialize
        // its canonical text. setFileYaml overrides activeFileText with the raw typed
        // text afterwards.
        if (state.fileExplorerMode) {
            Object.assign(result, fileViewOf(resources, state.activeFile));
        }

        const nextYaml = resourcesToYaml(resources);
        localStorage.setItem(YAML_KEY, nextYaml);
        result.yaml = nextYaml;
        result.yamlError = null;
        return result;
    };

    /**
     * Re-derive the graph from a changed LAYOUT only — used after physical node
     * rect / namespace rect edits so DaemonSet boxes (and their Pod counts)
     * follow the geometry. Never serializes YAML: the resource model is
     * unchanged, so the editor text/comments are preserved (invariant 3).
     */
    const refreshDerived = (
        state: VeltraState,
        nsLayout: NsLayout
    ): Partial<VeltraState> => {
        const derived = deriveGraph(toResources(state.nodes), state.nodes, state.userEdges, nsLayout);
        const { layoutChanged, ...rest } = derived;
        if (layoutChanged && derived.nsLayout) {
            persistNsLayout(derived.nsLayout);
        }
        return { ...rest, nsLayout: derived.nsLayout ?? nsLayout };
    };

    // ── Initial load ──────────────────────────────────────────────────────
    const savedYaml = localStorage.getItem(YAML_KEY);
    let yamlVal = savedYaml !== null ? savedYaml : DEFAULT_YAML;
    const userEdgesVal = readUserEdges();

    let initialGraph: {
        nodes: Node<K8sNodeData>[];
        inferredEdges: Edge[];
        edges: Edge[];
        nsLayout?: NsLayout | null;
    } = {
        nodes: [],
        inferredEdges: [],
        edges: [],
        nsLayout: undefined,
    };
    let initialHpaOverrides: HpaReplicaOverride[] = [];
    let initialError: string | null = null;

    // Persisted namespace layout, or null (derive from the live graph until the
    // user actually edits rectangles).
    const savedNsLayout = readNsLayout();

    try {
        const resources = parseYaml(yamlVal);
        // HorizontalPodAutoscaler priority also corrects pasted/saved YAML on load: the clamped value
        // is written back into the model AND the editor so nothing disagrees.
        const overrides = applyHpaReplicaOverrides(resources);
        if (overrides.length) {
            const nextYaml = resourcesToYaml(resources);
            localStorage.setItem(YAML_KEY, nextYaml);
            yamlVal = nextYaml;
            initialHpaOverrides = overrides;
        }
        initialGraph = deriveGraph(resources, [], userEdgesVal, savedNsLayout);
        initialGraph.nsLayout = initialGraph.nsLayout ?? savedNsLayout;
    } catch (e: any) {
        // Keep the editor content (with error surfaced) and an empty canvas —
        // never render a graph that doesn't correspond to the visible YAML.
        initialError = e.message || String(e);
    }

    // File-explorer mode is persisted; the active file is re-validated against the
    // restored manifest (falling back to the first virtual file when it's gone).
    const savedFileExplorerMode = localStorage.getItem(FILE_EXPLORER_KEY) === '1';
    const savedActiveFile = localStorage.getItem(ACTIVE_FILE_KEY);
    let initialFileView = { activeFile: null as string | null, activeFileText: '' };
    if (savedFileExplorerMode) {
        const bootResources = toResources(initialGraph.nodes);
        const bootFileOf = computeFileOf(bootResources);
        let path = savedActiveFile && new Set(bootFileOf.values()).has(savedActiveFile)
            ? savedActiveFile
            : null;
        if (path === null) path = bootFileOf.values().next().value ?? null;
        initialFileView = fileViewOf(bootResources, path);
    }

    return {
        yaml: yamlVal,
        nodes: initialGraph.nodes,
        inferredEdges: initialGraph.inferredEdges,
        edges: initialGraph.edges,
        userEdges: userEdgesVal,
        selectedResource: null,
        yamlError: initialError,
        notice: null,
        hpaOverrides: initialHpaOverrides,
        pendingConfigMapLink: null,
        pendingPvcLink: null,
        pendingSecretLink: null,
        pendingIngressTlsLink: null,
        nsEditMode: false,
        nodeEditMode: false,
        nsLayout: initialGraph.nsLayout ?? savedNsLayout,
        fileExplorerMode: savedFileExplorerMode,
        activeFile: initialFileView.activeFile,
        activeFileText: initialFileView.activeFileText,
        fileYamlError: null,

        setNotice: (notice) => set({ notice }),

        setYaml: (value: string) => {
            try {
                const resources = parseYaml(value);
                // HorizontalPodAutoscaler priority: clamp + write back the corrected YAML to the editor
                // (a targeted workload's replicas can never stay below minReplicas).
                const hpaOverrides = applyHpaReplicaOverrides(resources);
                const nextYaml = hpaOverrides.length ? resourcesToYaml(resources) : value;
                if (hpaOverrides.length) {
                    localStorage.setItem(YAML_KEY, nextYaml);
                }
                const state = get();
                // Fresh placement for resources added through the editor: a stale
                // pinned position from a previously deleted resource with the same
                // kind+name would bypass the lane layout AND the placement repair.
                const liveKeys = new Set(state.nodes.map((n) => `${n.data.kind}:${n.data.name}`));
                clearSavedPositions(
                    resources
                        .map((r) => `${r.kind}:${r.metadata?.name}`)
                        .filter((key) => !liveKeys.has(key))
                );
                const derivedResult = deriveGraph(resources, state.nodes, state.userEdges, state.nsLayout);
                const { layoutChanged, ...derived } = derivedResult;
                if (layoutChanged && derived.nsLayout) {
                    persistNsLayout(derived.nsLayout);
                }
                const sel = state.selectedResource;
                const selectionStillExists =
                    sel && derived.nodes.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);
                set({
                    yaml: nextYaml,
                    ...derived,
                    yamlError: null,
                    selectedResource: selectionStillExists ? sel : null,
                    hpaOverrides,
                    // Load Sample / YAML imports can change the tree while file mode
                    // is on — re-validate the active file against the new manifest.
                    ...(state.fileExplorerMode ? fileViewOf(resources, state.activeFile) : {}),
                });
            } catch (err: any) {
                // Graceful error: update raw text and store the error, but do NOT wipe/flicker the graph
                set({ yaml: value, yamlError: err.message || String(err) });
            }
        },

        setCanvasNodes: (nodes: Node<K8sNodeData>[]) =>
            set((state) => {
                const removed = state.nodes.filter((n) => !nodes.some((m) => m.id === n.id));
                const removedIds = new Set(removed.map((n) => n.id));
                // Real deleted resources leave no position pin behind (synthetic
                // ones keep theirs — the rebuild re-materializes them in place).
                clearSavedPositions(
                    removed
                        .filter((n) => !n.data.synthetic)
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );
                // Deleting the real DaemonSet node (its boxes/card) leaves no
                // per-box RELATIVE pins behind.
                new Set(
                    removed
                        .filter((n) => !n.data.synthetic && n.data.kind === 'DaemonSet')
                        .map((n) => n.data.name)
                ).forEach((dsName) => clearDaemonSetBoxPins(dsName));
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
            const state = get();
            const dragged = state.nodes.filter((n) => !n.parentId && draggedIds.includes(n.id));
            // Regular nodes pin absolute positions under `${kind}:${name}`;
            // DaemonSet boxes pin RELATIVE offsets inside their node rect (under
            // `DaemonSetBox:<ds>:<node>`), so node/cluster moves never invalidate
            // them and boxes never collide on the shared `DaemonSet:<name>` key.
            const regular = dragged.filter((n) => n.data.assignedNode === undefined);
            mergePositionsIntoStorage(
                regular.map((n) => ({
                    key: `${n.data.kind}:${n.data.name}`,
                    value: n.position,
                }))
            );
            const boxes = dragged.filter((n) => n.data.assignedNode !== undefined);
            if (boxes.length && state.nsLayout) {
                const entries: Array<{ key: string; value: { x: number; y: number } }> = [];
                boxes.forEach((box) => {
                    const rect = state.nsLayout!.nodes.find((nd) => nd.name === box.data.assignedNode);
                    if (!rect) return;
                    entries.push({
                        key: daemonSetBoxPinKey(box.data.name, rect.name),
                        value: {
                            x: box.position.x - rect.x,
                            y: box.position.y - rect.y,
                        },
                    });
                });
                mergePositionsIntoStorage(entries);
            }
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
                // Cluster-scoped kinds (PV/StorageClass) can never hold a namespace.
                const namespace = isClusterScoped(kind)
                    ? undefined
                    : patch.namespace !== undefined
                    ? patch.namespace
                    : node.data.namespace;

                if (!name) return {}; // never allow a nameless resource
                // A DaemonSet's sibling boxes share its kind+name — they are the
                // SAME logical resource, never a clash (one box per hosting node).
                const duplicate = state.nodes.some(
                    (n) =>
                        n.id !== nodeId &&
                        n.data.kind === kind &&
                        n.data.name === name &&
                        !isDaemonSetSibling(n, {
                            kind: node.data.kind,
                            name: node.data.name,
                        })
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

                // Cascade rename into name-based references: Ingress backends point at
                // Services by name, HorizontalPodAutoscaler scaleTargetRefs at Deployments/ReplicaSets by
                // name (label selectors are unaffected by renames)
                if (node.data.kind === 'Service' && kind === 'Service' && name !== node.data.name) {
                    updatedNodes = renameServiceReferences(updatedNodes, node.data.name, name);
                    updatedNodes = renameRouteBackendReferences(updatedNodes, node.data.name, name);
                }
                if (
                    (node.data.kind === 'Deployment' || node.data.kind === 'ReplicaSet') &&
                    kind === node.data.kind &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameWorkloadReferences(
                        updatedNodes,
                        node.data.kind as 'Deployment' | 'ReplicaSet',
                        node.data.name,
                        name
                    );
                    updatedNodes = renameVpaTargetReferences(
                        updatedNodes,
                        node.data.kind as 'Deployment' | 'ReplicaSet',
                        node.data.name,
                        name
                    );
                }
                if (node.data.kind === 'Pod' && kind === 'Pod' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'Pod', node.data.name, name);
                }
                if (node.data.kind === 'Job' && kind === 'Job' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'Job', node.data.name, name);
                }
                if (node.data.kind === 'CronJob' && kind === 'CronJob' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'CronJob', node.data.name, name);
                }
                if (node.data.kind === 'DaemonSet' && kind === 'DaemonSet' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'DaemonSet', node.data.name, name);
                }
                if (node.data.kind === 'ConfigMap' && kind === 'ConfigMap' && name !== node.data.name) {
                    updatedNodes = renameConfigMapReferences(updatedNodes, node.data.name, name);
                }
                if (node.data.kind === 'Secret' && kind === 'Secret' && name !== node.data.name) {
                    updatedNodes = renameSecretReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'PersistentVolumeClaim' &&
                    kind === 'PersistentVolumeClaim' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renamePvcReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'PersistentVolume' &&
                    kind === 'PersistentVolume' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renamePvReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'StorageClass' &&
                    kind === 'StorageClass' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameStorageClassReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'GatewayClass' &&
                    kind === 'GatewayClass' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameGatewayClassReferences(updatedNodes, node.data.name, name);
                }
                if (node.data.kind === 'Gateway' && kind === 'Gateway' && name !== node.data.name) {
                    updatedNodes = renameGatewayReferences(updatedNodes, node.data.name, name);
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
                    // A renamed DaemonSet takes its per-box RELATIVE pins along.
                    if (node.data.kind === 'DaemonSet' && kind === 'DaemonSet') {
                        renameDaemonSetBoxPins(node.data.name, name);
                    }
                }

                const sel = state.selectedResource;
                const wasSelected = sel && sel.kind === node.data.kind && sel.name === node.data.name;
                // A pure namespace change (same kind+name, different namespace) is
                // a reassignment: the placement engine re-positions the node inside
                // the target namespace — fresh, overlap-free, growing the box when
                // the resource doesn't fit. Its saved position is cleared and its
                // old position is not inherited (it never belonged to this box).
                const isNsReassignment =
                    kind === node.data.kind &&
                    name === node.data.name &&
                    !isClusterScoped(kind) &&
                    namespace !== undefined &&
                    namespace !== (node.data.namespace ?? 'default');
                const prevNodes = isNsReassignment
                    ? updatedNodes.filter((n) => n.id !== nodeId)
                    : updatedNodes;
if (isNsReassignment) {
                    clearSavedPositions([`${kind}:${name}`]);
                }
                return commitResources(state, toResources(updatedNodes), prevNodes, {
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
                // Gateway API is one family: deleting any GatewayClass/Gateway/Route
                // removes the whole linked cluster (class → gateways → routes), but
                // never the Services its Routes route to (backendRefs are not ownership).
                if (node && isGatewayApiKind(node.data.kind)) {
                    collectGatewayApiFamily(state.nodes, nodeId).forEach((id) => doomed.add(id));
                }
                if (doomed.size === 0) return {};
                // Deleted resources leave no trace in the position store — a future
                // re-create with the same kind+name must get fresh placement.
                clearSavedPositions(
                    state.nodes
                        .filter((n) => doomed.has(n.id))
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );
                // A deleted DaemonSet (any of its boxes/card removes the whole
                // resource) leaves no per-box RELATIVE pins behind.
                new Set(
                    state.nodes
                        .filter((n) => doomed.has(n.id) && n.data.kind === 'DaemonSet')
                        .map((n) => n.data.name)
                ).forEach((dsName) => clearDaemonSetBoxPins(dsName));

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

                // ConfigMap ↔ workload/Pod: a valid semantic link, but the user must pick
                // the consumption mechanism (envFrom / volumes / env-key) first — surface
                // the post-drag prompt instead of committing immediately. `sourceNode`/
                // `targetNode` are real (synthetic targets were redirected to their owner).
                const isConfigMapTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'DaemonSet' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'ConfigMap' && isConfigMapTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'ConfigMap' && isConfigMapTarget(sourceNode.data.kind))
                ) {
                    const cm = sourceNode.data.kind === 'ConfigMap' ? sourceNode : targetNode;
                    const workload = sourceNode.data.kind === 'ConfigMap' ? targetNode : sourceNode;
                    return {
                        pendingConfigMapLink: {
                            cm: { name: cm.data.name },
                            target: {
                                kind: workload.data.kind as 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: workload.data.name,
                            },
                        },
                    };
                }

                // PVC ↔ Pod/Deployment/ReplicaSet: a valid semantic link, but the
                // volume name is picked in the post-drag prompt before committing.
                // Single-node claims (ReadWriteOnce/ReadWriteOncePod) cannot serve a
                // workload that runs more than one replica — reject those up front.
                const isPvcMountTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'DaemonSet' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'PersistentVolumeClaim' && isPvcMountTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'PersistentVolumeClaim' && isPvcMountTarget(sourceNode.data.kind))
                ) {
                    const pvc = sourceNode.data.kind === 'PersistentVolumeClaim' ? sourceNode : targetNode;
                    const mountTarget = sourceNode.data.kind === 'PersistentVolumeClaim' ? targetNode : sourceNode;
                    const multiPod = mountTarget.data.kind === 'Job'
                        ? parallelismOf(mountTarget.data.resource) > 1
                        : mountTarget.data.kind === 'CronJob'
                        ? cronParallelismOf(mountTarget.data.resource) > 1
                        : mountTarget.data.kind !== 'Pod' && replicasOf(mountTarget.data.resource) > 1;
                    if (multiPod && isSingleNodeAccessMode(pvc.data.resource)) {
                        return {
                            notice: makeNotice(
                                'error',
                                mountTarget.data.kind === 'Job'
                                    ? `Job ${mountTarget.data.name} runs ${parallelismOf(mountTarget.data.resource)} pods in parallel — a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Reduce parallelism to 1 or use ReadWriteMany/ReadOnlyMany.`
                                    : mountTarget.data.kind === 'CronJob'
                                    ? `CronJob ${mountTarget.data.name} runs ${cronParallelismOf(mountTarget.data.resource)} pods in parallel — a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Reduce parallelism to 1 or use ReadWriteMany/ReadOnlyMany.`
                                    : `${mountTarget.data.kind} ${mountTarget.data.name} runs ${replicasOf(mountTarget.data.resource)} replicas — a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Scale down to 1 or use ReadWriteMany/ReadOnlyMany.`
                            ),
                        };
                    }
                    return {
                        pendingPvcLink: {
                            pvc: { name: pvc.data.name },
                            target: {
                                kind: mountTarget.data.kind as 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: mountTarget.data.name,
                            },
                        },
                    };
                }

                // Secret ↔ workload/Pod: a valid semantic link, but the user must pick
                // the consumption mechanism (envFrom / volumes / env-key) first —
                // surface the post-drag prompt instead of committing immediately.
                const isSecretTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'DaemonSet' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'Secret' && isSecretTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'Secret' && isSecretTarget(sourceNode.data.kind))
                ) {
                    const secret = sourceNode.data.kind === 'Secret' ? sourceNode : targetNode;
                    const workload = sourceNode.data.kind === 'Secret' ? targetNode : sourceNode;
                    return {
                        pendingSecretLink: {
                            secret: { name: secret.data.name },
                            target: {
                                kind: workload.data.kind as 'Pod' | 'Deployment' | 'DaemonSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: workload.data.name,
                            },
                        },
                    };
                }

                // Ingress ↔ Secret: a valid TLS link, but the user picks the hosts in
                // the post-drag prompt before committing.
                if (
                    (sourceNode.data.kind === 'Ingress' && targetNode.data.kind === 'Secret') ||
                    (targetNode.data.kind === 'Ingress' && sourceNode.data.kind === 'Secret')
                ) {
                    const ingress = sourceNode.data.kind === 'Ingress' ? sourceNode : targetNode;
                    const secret = sourceNode.data.kind === 'Secret' ? sourceNode : targetNode;
                    return {
                        pendingIngressTlsLink: {
                            ingress: { name: ingress.data.name },
                            secret: { name: secret.data.name },
                        },
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

        setPendingConfigMapLink: (link) => set({ pendingConfigMapLink: link }),

        cancelConfigMapLink: () => set({ pendingConfigMapLink: null }),

        confirmConfigMapLink: (mechanism, key) =>
            set((state) => {
                const pending = state.pendingConfigMapLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const cmIdx = resources.findIndex(
                    (r) => r.kind === 'ConfigMap' && r.metadata.name === pending.cm.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (cmIdx < 0 || targetIdx < 0) {
                    return { pendingConfigMapLink: null };
                }
                const linked = linkConfigMapToWorkload(resources, cmIdx, targetIdx, mechanism, key);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingConfigMapLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingPvcLink: (link) => set({ pendingPvcLink: link }),

        cancelPvcLink: () => set({ pendingPvcLink: null }),

        confirmPvcLink: (volumeName) =>
            set((state) => {
                const pending = state.pendingPvcLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const pvcIdx = resources.findIndex(
                    (r) =>
                        r.kind === 'PersistentVolumeClaim' &&
                        r.metadata.name === pending.pvc.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (pvcIdx < 0 || targetIdx < 0) {
                    return { pendingPvcLink: null };
                }
                const linked = linkPvcToWorkload(resources, pvcIdx, targetIdx, volumeName);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingPvcLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingSecretLink: (link) => set({ pendingSecretLink: link }),

        cancelSecretLink: () => set({ pendingSecretLink: null }),

        confirmSecretLink: (mechanism, key, volumeName) =>
            set((state) => {
                const pending = state.pendingSecretLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const secretIdx = resources.findIndex(
                    (r) => r.kind === 'Secret' && r.metadata.name === pending.secret.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (secretIdx < 0 || targetIdx < 0) {
                    return { pendingSecretLink: null };
                }
                const linked = linkSecretToWorkload(
                    resources,
                    secretIdx,
                    targetIdx,
                    mechanism,
                    key,
                    volumeName
                );
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingSecretLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingIngressTlsLink: (link) => set({ pendingIngressTlsLink: link }),

        cancelIngressTlsLink: () => set({ pendingIngressTlsLink: null }),

        confirmIngressTlsLink: (hosts) =>
            set((state) => {
                const pending = state.pendingIngressTlsLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const ingressIdx = resources.findIndex(
                    (r) => r.kind === 'Ingress' && r.metadata.name === pending.ingress.name
                );
                const secretIdx = resources.findIndex(
                    (r) => r.kind === 'Secret' && r.metadata.name === pending.secret.name
                );
                if (ingressIdx < 0 || secretIdx < 0) {
                    return { pendingIngressTlsLink: null };
                }
                const linked = linkIngressToSecret(resources, ingressIdx, secretIdx, hosts);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingIngressTlsLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        addConfiguredNode: (
            kind: SupportedKind,
            resource: K8sResource,
            link?: ConfigMapLinkPayload | PvcLinkPayload | SecretLinkPayload | IngressTlsPayload,
            opts?: { desiredNodes?: number }
        ) =>
            set((state) => {
                const name = resource.metadata?.name?.trim();
                if (!name) return {};
                if (state.nodes.some((n) => n.data.kind === kind && n.data.name === name)) {
                    return {}; // modal validates and surfaces this
                }
                // Let buildGraph auto-place the new resource (lane/cursor layout).
                // A stale saved position from a previously deleted resource with
                // the same kind+name would bypass the lane AND the placement
                // repair — clear it so the node lands fresh, inside its box.
                clearSavedPositions([`${kind}:${name}`]);
                // Same for a re-created DaemonSet's per-box RELATIVE pins.
                if (kind === 'DaemonSet') clearDaemonSetBoxPins(name);
                // A DaemonSet creation also materializes physical node rects:
                // the modal's "Nodes" field is the desired TOTAL count of nodes
                // HOSTING the DaemonSet's namespace — existing node rects that
                // already overlap the namespace rect count toward it, so only
                // the shortfall is tiled over the namespace (canvas-only chrome,
                // never in YAML).
                let nsLayout: NsLayout | null | undefined = undefined;
                if (kind === 'DaemonSet' && opts?.desiredNodes && opts.desiredNodes > 0) {
                    const layout = ensureNsLayout(state);
                    let next = { ...layout };
                    const nsName = resource.metadata.namespace ?? 'default';
                    // Ensure the namespace has a rectangle to cover: fresh
                    // namespaces have none (auto-derived rects only hug
                    // namespaces that already contain resources).
                    let nsRect = next.namespaces.find((n) => n.name === nsName);
                    if (!nsRect) {
                        const placed = placeNewNamespaceRect(next, 320, 240, {
                            x: next.cluster.x + 20,
                            y: next.cluster.y + 20,
                        });
                        next = {
                            ...next,
                            cluster: placed.cluster,
                            namespaces: [...next.namespaces, { name: nsName, ...placed.rect }],
                        };
                        nsRect = { name: nsName, ...placed.rect };
                    }
                    const existing = next.nodes.filter((n) => rectsOverlap(nsRect!, n)).length;
                    const missing = Math.max(opts.desiredNodes - existing, 0);
                    if (missing > 0) {
                        const tiled = tileNodesOverNamespace(next, nsName, missing);
                        let nextWithTiles = {
                            ...next,
                            cluster: tiled.cluster,
                            namespaces: tiled.namespaces,
                        };
                        tiled.rects.forEach((rect) => {
                            nextWithTiles = {
                                ...nextWithTiles,
                                nodes: [
                                    ...nextWithTiles.nodes,
                                    { name: nextNodeName(nextWithTiles, 1), ...rect },
                                ],
                            };
                        });
                        persistNsLayout(nextWithTiles);
                        nsLayout = nextWithTiles;
                    }
                }
                let resources = [...toResources(state.nodes), resource];
                const newIdx = resources.length - 1;
                // Create-modal ConfigMap link: also write the reference into the target
                // resource's Pod spec in the same commit (synthetic targets are already
                // resolved to their real owner by the modal).
                if (link && 'targetKind' in link && 'mechanism' in link) {
                    if (link.mechanism === 'envFrom' || link.mechanism === 'volumes' || link.mechanism === 'envKey') {
                        if (kind === 'ConfigMap') {
                            const cmIdx = newIdx;
                            const targetIdx = resources.findIndex(
                                (r) => r.kind === link.targetKind && r.metadata.name === link.targetName
                            );
                            if (targetIdx >= 0) {
                                resources = linkConfigMapToWorkload(
                                    resources,
                                    cmIdx,
                                    targetIdx,
                                    link.mechanism,
                                    link.key
                                ).resources;
                            }
                        } else if (kind === 'Secret') {
                            const secretIdx = newIdx;
                            const targetIdx = resources.findIndex(
                                (r) => r.kind === link.targetKind && r.metadata.name === link.targetName
                            );
                            if (targetIdx >= 0) {
                                resources = linkSecretToWorkload(
                                    resources,
                                    secretIdx,
                                    targetIdx,
                                    link.mechanism,
                                    link.key,
                                    'volumeName' in link ? link.volumeName : undefined
                                ).resources;
                            }
                        }
                    }
                }
                // Create-modal Ingress TLS: write spec.tls[] directly on the new Ingress.
                if (link && 'secretName' in link) {
                    const ingressSpec = (resources[newIdx].spec ?? {}) as Record<string, any>;
                    const tls: any[] = Array.isArray(ingressSpec.tls) ? ingressSpec.tls : [];
                    tls.push({ secretName: link.secretName, hosts: link.hosts });
                    ingressSpec.tls = tls;
                }
                // Create-modal PVC links: mount the claim into a Pod, Deployment or
                // ReplicaSet (volume name prompt; workloads get the reference in their
                // Pod template) and bind it to exactly one PV or StorageClass.
                if (link && 'mountTarget' in link) {
                    if (link.mountTarget) {
                        const targetIdx = resources.findIndex(
                            (r) =>
                                r.kind === link.mountTarget!.kind &&
                                r.metadata.name === link.mountTarget!.name
                        );
                        if (targetIdx >= 0) {
                            resources = linkPvcToWorkload(
                                resources,
                                newIdx,
                                targetIdx,
                                link.mountTarget.volumeName
                            ).resources;
                        }
                    }
                    if (link.bindTarget) {
                        const bindIdx = resources.findIndex(
                            (r) =>
                                r.kind === link.bindTarget!.kind &&
                                r.metadata.name === link.bindTarget!.name
                        );
                        if (bindIdx >= 0) {
                            const pvcSpec = (resources[newIdx].spec ?? {}) as Record<string, any>;
                            if (link.bindTarget.kind === 'PersistentVolume') {
                                pvcSpec.volumeName = link.bindTarget.name;
                                delete pvcSpec.storageClassName;
                            } else {
                                pvcSpec.storageClassName = link.bindTarget.name;
                                delete pvcSpec.volumeName;
                            }
                        }
                    }
                }
                return commitResources(state, resources, state.nodes, {
                    selectedResource: { kind, name },
                    ...(nsLayout ? { nsLayout } : {}),
                });
            }),

        addConfiguredNodes: (resources, selectedResource) =>
            set((state) => {
                // Validate the whole batch before touching the model: every resource
                // needs a name and no kind+name may collide with the live canvas.
                const existing = toResources(state.nodes);
                const names = new Set<string>();
                for (const resource of resources) {
                    const name = resource.metadata?.name?.trim();
                    if (!name) return {}; // modal validates and surfaces this
                    const key = `${resource.kind}:${name}`;
                    if (names.has(key)) return {};
                    names.add(key);
                    if (existing.some((r) => r.kind === resource.kind && r.metadata.name === name)) {
                        return {};
                    }
                    // Fresh placement: never inherit a stale pin from a previously
                    // deleted resource with the same kind+name.
                    clearSavedPositions([key]);
                }
                // The batch is already cross-referenced (gatewayClassName / parentRefs /
                // backendRefs are baked in by the modal) — commit everything at once so
                // the graph, inferred edges and YAML rebuild in one pass.
                return commitResources(state, [...existing, ...resources], state.nodes, {
                    selectedResource: selectedResource ?? null,
                });
            }),

        resetLayout: () => {
            localStorage.removeItem(POSITIONS_KEY);
            localStorage.removeItem(NS_LAYOUT_KEY);
            set((state) => {
                // Rebuild with no previous coordinates so every node returns to auto-layout.
                // HorizontalPodAutoscaler clamps are already written into the node resources; re-run the
                // override pass so the status bar reflects the current state.
                const resources = toResources(state.nodes);
                const hpaOverrides = applyHpaReplicaOverrides(resources);
                // resetLayout discards the layout entirely (nsLayout: null below),
                // so the repair pass runs in pure auto mode — no layout to grow.
                const derivedResult = deriveGraph(resources, [], state.userEdges, null);
                const { layoutChanged, ...derived } = derivedResult;
                if (layoutChanged && derived.nsLayout) {
                    persistNsLayout(derived.nsLayout);
                }
                return {
                    ...derived,
                    hpaOverrides,
                    // Namespace/cluster frames re-derive from the fresh auto-layout.
                    nsLayout: null,
                    // Re-validate the active file after the layout reset rebuild.
                    ...(state.fileExplorerMode ? fileViewOf(resources, state.activeFile) : {}),
                };
            });
        },

        clearAll: () => {
            localStorage.setItem(YAML_KEY, '');
            localStorage.removeItem(POSITIONS_KEY);
            localStorage.removeItem(USER_EDGES_KEY);
            localStorage.removeItem(NS_LAYOUT_KEY);
            set({
                yaml: '',
                nodes: [],
                inferredEdges: [],
                edges: [],
                userEdges: [],
                selectedResource: null,
                yamlError: null,
                notice: null,
                hpaOverrides: [],
                pendingConfigMapLink: null,
                pendingPvcLink: null,
                pendingSecretLink: null,
                pendingIngressTlsLink: null,
                nsEditMode: false,
                nodeEditMode: false,
                nsLayout: null,
                activeFile: null,
                activeFileText: '',
                fileYamlError: null,
            });
        },

        setNsEditMode: (on) => {
            // The two frame modes share one layout — leaving one for the other
            // persists it, exactly like pressing Done.
            if (on && get().nodeEditMode) {
                const current = get().nsLayout;
                if (current) persistNsLayout(current);
                set({ nodeEditMode: false });
            }
            if (!on) {
                // Auto-persist the layout when leaving namespace editing mode —
                // but only if the user actually edited it (null = pure auto-layout).
                const layout = get().nsLayout;
                if (layout) persistNsLayout(layout);
            }
            set({ nsEditMode: on });
        },

        setNodeEditMode: (on) => {
            if (on && get().nsEditMode) {
                const current = get().nsLayout;
                if (current) persistNsLayout(current);
                set({ nsEditMode: false });
            }
            if (!on) {
                const layout = get().nsLayout;
                if (layout) persistNsLayout(layout);
            }
            set({ nodeEditMode: on });
        },

        moveNamespace: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // Namespace rectangles never collide: the dragged rect is pushed out
                // of every other namespace rect before the translation is computed.
                const others = layout.namespaces.filter((ns) => ns.name !== name);
                // …and it can never leave the cluster: sibling resolution first, then
                // a final clamp to the cluster bounds wins (a dragged box stays inside
                // even when the cluster has no spare room — containment over overlap).
                const clamped = clampRectToRect(
                    resolveMoveCollision(rect, others),
                    layout.cluster
                );
                // Translation is the diff between the passed rect and the one the
                // layout currently holds — the caller may pass absolute rects
                // anchored at drag start without double-applying.
                const old = layout.namespaces.find((ns) => ns.name === name);
                const dx = old ? clamped.x - old.x : 0;
                const dy = old ? clamped.y - old.y : 0;
                // Only top-level namespaced nodes ride along with their rectangle;
                // nested children (Pods inside RSs/Deployments) follow via their
                // parent's absolute position and cluster-scoped kinds never move
                // with a namespace.
                const nextNodes = state.nodes.map((n) => {
                    if (n.parentId) return n;
                    // DaemonSet boxes are node-bound — a namespace drag must not
                    // pull them along (they follow their node rect instead).
                    if (n.data.assignedNode !== undefined) return n;
                    if (isClusterScoped(n.data.kind)) return n;
                    if ((n.data.namespace ?? 'default') !== name) return n;
                    return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
                });
                return {
                    nodes: nextNodes,
                    nsLayout: {
                        ...layout,
                        namespaces: upsertNamedRect(layout.namespaces, name, clamped),
                    },
                };
            }),

        moveClusterRect: (cluster) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const dx = cluster.x - layout.cluster.x;
                const dy = cluster.y - layout.cluster.y;
                // The whole cluster translates: every top-level node (namespaced
                // and cluster-scoped alike) plus all node and namespace rectangles.
                const nextNodes = state.nodes.map((n) =>
                    n.parentId ? n : { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
                );
                const nodes = layout.nodes.map((nd) => ({
                    ...nd,
                    x: nd.x + dx,
                    y: nd.y + dy,
                }));
                const namespaces = layout.namespaces.map((ns) => ({
                    ...ns,
                    x: ns.x + dx,
                    y: ns.y + dy,
                }));
                return { nodes: nextNodes, nsLayout: { cluster, nodes, namespaces } };
            }),

        resizeNsRect: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // Resize never collides either: growth is stopped at the nearest
                // neighbor's facing edge (west/north drags stop at its trailing
                // edge), a shrink can't leave a contained resource outside the
                // box, and the box can't extend outside the cluster.
                const old = layout.namespaces.find((ns) => ns.name === name);
                const others = layout.namespaces.filter((ns) => ns.name !== name);
                const clamped = old
                    ? resolveResizeCollision(
                          old,
                          rect,
                          others,
                          NAMESPACE_MIN_RECT,
                          namespaceContentRects(state.nodes, name),
                          layout.cluster
                      )
                    : rect;
                return {
                    nsLayout: {
                        ...layout,
                        namespaces: upsertNamedRect(layout.namespaces, name, clamped),
                    },
                };
            }),

        resizeClusterRect: (rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // The cluster can't shrink past its node or namespace boxes either
                // (they act as its content) — otherwise a box would end up outside.
                const clamped = resolveResizeCollision(
                    layout.cluster,
                    rect,
                    [],
                    NAMESPACE_MIN_RECT,
                    [...layout.nodes, ...layout.namespaces]
                );
                return { nsLayout: { ...layout, cluster: clamped } };
            }),

        addNamespace: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Namespace name cannot be empty.') };
                }
                // Duplicates cover persisted rectangles AND namespaces currently
                // discovered from the graph (YAML-authored, never edited).
                const exists =
                    layout.namespaces.some((ns) => ns.name === trimmed) ||
                    state.nodes.some(
                        (n) =>
                            !n.data.synthetic &&
                            !isClusterScoped(n.data.kind) &&
                            (n.data.namespace ?? 'default') === trimmed
                    );
                if (exists) {
                    return {
                        notice: makeNotice(
                            'error',
                            `Namespace “${trimmed}” already exists on the canvas.`
                        ),
                    };
                }
                // The new rect always lands INSIDE the cluster (first free pocket);
                // when there is no room, the cluster grows to fit it — exactly like
                // repairPlacements grows boxes for new resources.
                const placed = placeNewNamespaceRect(
                    layout,
                    rect?.width ?? 320,
                    rect?.height ?? 240,
                    {
                        x: rect?.x ?? layout.cluster.x + 20,
                        y: rect?.y ?? layout.cluster.y + 20,
                    }
                );
                return {
                    nsLayout: {
                        ...layout,
                        cluster: placed.cluster,
                        namespaces: [
                            ...layout.namespaces,
                            { name: trimmed, ...placed.rect },
                        ],
                    },
                    notice: makeNotice(
                        'success',
                        `Namespace “${trimmed}” added — drag resources onto it to assign them.`
                    ),
                };
            }),

        deleteNamespace: (name) =>
            set((state) => {
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Namespace name cannot be empty.') };
                }
                if (PROTECTED_NAMESPACES.has(trimmed)) {
                    return {
                        notice: makeNotice(
                            'error',
                            `Namespace “${trimmed}” is protected and cannot be deleted.`
                        ),
                    };
                }
                // Cascade like Kubernetes: every top-level real resource living in
                // the namespace is deleted, and its nested descendants (Pods under
                // RS under Deployment) go with it via collectWithDescendants.
                const topLevelInNs = state.nodes.filter(
                    (n) =>
                        !n.parentId &&
                        !n.data.synthetic &&
                        !isClusterScoped(n.data.kind) &&
                        (n.data.namespace ?? 'default') === trimmed
                );
                const doomed = new Set<string>();
                topLevelInNs.forEach((n) => {
                    collectWithDescendants(state.nodes, n.id).forEach((id) => doomed.add(id));
                });

                const layout = ensureNsLayout(state);
                const namespaces = layout.namespaces.filter((ns) => ns.name !== trimmed);
                const nsLayout: NsLayout = { ...layout, namespaces };

                // Empty namespace: pure layout change — never touch YAML or the
                // graph (serializing would destroy user comments/formatting).
                if (doomed.size === 0) {
                    return {
                        nsLayout,
                        notice: makeNotice('success', `Namespace “${trimmed}” deleted.`),
                    };
                }

                const remaining = state.nodes.filter((n) => !doomed.has(n.id));
                // Namespace deletion takes its resources' position pins with it.
                clearSavedPositions(
                    state.nodes
                        .filter((n) => doomed.has(n.id))
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );
                const userEdges = state.userEdges.filter(
                    (e) => !doomed.has(e.source) && !doomed.has(e.target)
                );
                const sel = state.selectedResource;
                const selectionRemoved =
                    sel &&
                    !remaining.some(
                        (n) => n.data.kind === sel.kind && n.data.name === sel.name
                    );

                return {
                    ...commitResources(state, toResources(remaining), remaining, {
                        userEdges,
                        selectedResource: selectionRemoved ? null : sel,
                    }),
                    nsLayout,
                    notice: makeNotice(
                        'success',
                        `Namespace “${trimmed}” deleted with ${doomed.size} resource${doomed.size > 1 ? 's' : ''}.`
                    ),
                };
            }),

        moveNodeRect: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // Node rectangles never collide (physical exclusivity): the
                // dragged rect is pushed out of every other node rect before the
                // translation is computed. Namespace rects are NOT blockers —
                // they may straddle any number of nodes.
                const others = layout.nodes.filter((nd) => nd.name !== name);
                // …and it can never leave the cluster: sibling resolution first,
                // then a final clamp to the cluster bounds wins.
                const clamped = clampRectToRect(
                    resolveMoveCollision(rect, others),
                    layout.cluster
                );
                const old = layout.nodes.find((nd) => nd.name === name);
                if (!old) {
                    return {
                        nsLayout: {
                            ...layout,
                            nodes: upsertNamedRect(layout.nodes, name, clamped),
                        },
                    };
                }
                // Translation is the diff between the passed rect and the one the
                // layout currently holds — the caller may pass absolute rects
                // anchored at drag start without double-applying.
                const dx = clamped.x - old.x;
                const dy = clamped.y - old.y;
                // Only namespaces FULLY contained in the node's pre-move rect ride
                // along (with their top-level resources); a straddling namespace
                // belongs to other nodes too, so it stays put — the node slides
                // out from under it instead of dragging it along.
                const rideAlong = new Set(
                    layout.namespaces
                        .filter((ns) => rectContainsRect(ns, old))
                        .map((ns) => ns.name)
                );
                const nextNodes = state.nodes.map((n) => {
                    if (n.parentId) return n;
                    // DaemonSet boxes follow THEIR node rect (never the
                    // namespace ride-along — they are node-bound chrome).
                    if (n.data.assignedNode === name) {
                        return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
                    }
                    if (isClusterScoped(n.data.kind)) return n;
                    if (!rideAlong.has(n.data.namespace ?? 'default')) return n;
                    return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
                });
                const namespaces = layout.namespaces.map((ns) =>
                    rideAlong.has(ns.name)
                        ? { ...ns, x: ns.x + dx, y: ns.y + dy }
                        : ns
                );
                return {
                    nodes: nextNodes,
                    nsLayout: {
                        ...layout,
                        nodes: upsertNamedRect(layout.nodes, name, clamped),
                        namespaces,
                    },
                };
            }),

        resizeNodeRect: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const old = layout.nodes.find((nd) => nd.name === name);
                const others = layout.nodes.filter((nd) => nd.name !== name);
                // Content = the namespace rects fully contained in the node's
                // pre-resize box: the box can never shrink past a namespace it
                // holds (a node can't evict one). Straddling namespaces are cut
                // freely — they live on other nodes too.
                const content = old
                    ? layout.namespaces.filter((ns) => rectContainsRect(ns, old))
                    : [];
                const clamped = old
                    ? resolveResizeCollision(
                          old,
                          rect,
                          others,
                          NODE_MIN_RECT,
                          content,
                          layout.cluster
                      )
                    : rect;
                // DaemonSet boxes on this node follow the rect live (clamped
                // inside it, anchored at its top-left when the box no longer
                // fits) so a shrinking node never leaves its boxes visually
                // stranded — the end-of-gesture refresh re-sweeps properly.
                const clampInto = (
                    x: number,
                    y: number,
                    w: number,
                    h: number,
                    c: Rect
                ): { x: number; y: number } => ({
                    x: Math.min(Math.max(x, c.x), Math.max(c.x, c.x + c.width - w)),
                    y: Math.min(Math.max(y, c.y), Math.max(c.y, c.y + c.height - h)),
                });
                const nextNodes = state.nodes.map((n) => {
                    if (n.data.assignedNode !== name) return n;
                    const w = typeof n.style?.width === 'number' ? n.style.width : FALLBACK_NODE_WIDTH;
                    const h = typeof n.style?.height === 'number' ? n.style.height : FALLBACK_NODE_HEIGHT;
                    return { ...n, position: clampInto(n.position.x, n.position.y, w, h, clamped) };
                });
                return {
                    nodes: nextNodes,
                    nsLayout: {
                        ...layout,
                        nodes: upsertNamedRect(layout.nodes, name, clamped),
                    },
                };
            }),

        addNode: (name, rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Node name cannot be empty.') };
                }
                // Nodes are never graph-derived, so only persisted rects can clash.
                if (layout.nodes.some((nd) => nd.name === trimmed)) {
                    return {
                        notice: makeNotice(
                            'error',
                            `Node “${trimmed}” already exists on the canvas.`
                        ),
                    };
                }
                // The new rect always lands INSIDE the cluster (first free pocket
                // avoiding node AND namespace rects — a fresh node starts empty);
                // when there is no room, the cluster grows to fit it.
                const placed = placeNewNodeRect(
                    layout,
                    rect?.width ?? 480,
                    rect?.height ?? 360,
                    {
                        x: rect?.x ?? layout.cluster.x + 20,
                        y: rect?.y ?? layout.cluster.y + 20,
                    }
                );
                const nextLayout: NsLayout = {
                    ...layout,
                    cluster: placed.cluster,
                    nodes: [...layout.nodes, { name: trimmed, ...placed.rect }],
                };
                return {
                    ...refreshDerived(state, nextLayout),
                    notice: makeNotice(
                        'success',
                        `Node “${trimmed}” added — drag namespaces onto it to place them on the node.`
                    ),
                };
            }),

        deleteNode: (name) =>
            set((state) => {
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Node name cannot be empty.') };
                }
                const layout = ensureNsLayout(state);
                const nodes = layout.nodes.filter((nd) => nd.name !== trimmed);
                if (nodes.length === layout.nodes.length) {
                    return {
                        notice: makeNotice('error', `Node “${trimmed}” not found.`),
                    };
                }
                // Pure layout change: nodes are canvas-only chrome that never own
                // resources — namespaces merely lose one node when they straddled
                // it, and the model/YAML stay untouched. DaemonSet boxes and Pod
                // counts follow the node list, so the graph is re-derived (never
                // serialized — the resource model is unchanged).
                const nextLayout = { ...layout, nodes };
                return {
                    ...refreshDerived(state, nextLayout),
                    notice: makeNotice(
                        'success',
                        `Node “${trimmed}” deleted — its namespaces stay on the cluster.`
                    ),
                };
            }),

        refreshLayoutDerived: () =>
            set((state) => {
                if (!state.nsLayout) return {};
                return refreshDerived(state, state.nsLayout);
            }),

        setFileExplorerMode: (on) => {
            localStorage.setItem(FILE_EXPLORER_KEY, on ? '1' : '0');
            set((state) => {
                if (!on) {
                    return { fileExplorerMode: false, fileYamlError: null };
                }
                const resources = toResources(state.nodes);
                const fileOf = computeFileOf(resources);
                let path = state.activeFile;
                if (path === null || !new Set(fileOf.values()).has(path)) {
                    // Prefer the file containing the selected resource, then the first file.
                    if (state.selectedResource) {
                        path = fileOf.get(`${state.selectedResource.kind}:${state.selectedResource.name}`) ?? null;
                    }
                    if (path === null) path = fileOf.values().next().value ?? null;
                }
                return { fileExplorerMode: true, ...fileViewOf(resources, path), fileYamlError: null };
            });
        },

        setActiveFile: (path) => {
            localStorage.setItem(ACTIVE_FILE_KEY, path ?? '');
            set((state) => fileViewOf(toResources(state.nodes), path));
        },

        setFileYaml: (path, value) =>
            set((state) => {
                if (!state.fileExplorerMode || !path) return {};
                let newFileResources: K8sResource[];
                try {
                    newFileResources = parseYaml(value);
                } catch (err: any) {
                    // Scoped version of invariant 9: an invalid file never wipes the
                    // model/canvas — the editor keeps the raw text and shows the error.
                    return { fileYamlError: err.message || String(err) };
                }
                // Remove the resources that currently live in this file, then merge the
                // re-parsed slice back into the single manifest and commit as usual.
                const all = toResources(state.nodes);
                const fileOf = computeFileOf(all);
                const rest = all.filter((r) => fileOf.get(resourceKeyOf(r)) !== path);
                // Resources newly added through the file editor get fresh placement —
                // never a stale pin from a previously deleted resource (see setYaml).
                const liveKeys = new Set(state.nodes.map((n) => `${n.data.kind}:${n.data.name}`));
                clearSavedPositions(
                    newFileResources
                        .map((r) => `${r.kind}:${r.metadata?.name}`)
                        .filter((key) => !liveKeys.has(key))
                );
                const result = commitResources(state, [...rest, ...newFileResources], state.nodes);
                // Keep the raw typed text in the editor (commitResources re-serializes
                // the canonical form; the user's formatting wins while typing).
                result.activeFileText = value;
                result.fileYamlError = null;
                return result;
            }),
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

export function apiVersionForKind(kind: SupportedKind): string {
    if (kind === 'Deployment' || kind === 'DaemonSet' || kind === 'ReplicaSet') return 'apps/v1';
    if (kind === 'Ingress') return 'networking.k8s.io/v1';
    if (kind === 'HorizontalPodAutoscaler') return 'autoscaling/v2';
    if (kind === 'VerticalPodAutoscaler') return 'autoscaling.k8s.io/v1';
    if (kind === 'StorageClass') return 'storage.k8s.io/v1';
    if (kind === 'Job' || kind === 'CronJob') return 'batch/v1';
    if (kind === 'Secret') return 'v1';
    if (kind === 'UDPRoute') return 'gateway.networking.k8s.io/v1alpha2';
    if (
        kind === 'GatewayClass' ||
        kind === 'Gateway' ||
        kind === 'HTTPRoute' ||
        kind === 'GRPCRoute' ||
        kind === 'TCPRoute' ||
        kind === 'TLSRoute'
    ) {
        return 'gateway.networking.k8s.io/v1';
    }
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

/** Rewrite HorizontalPodAutoscaler scaleTargetRef names when a Deployment/ReplicaSet is renamed. */
function renameWorkloadReferences(
    nodes: Node<K8sNodeData>[],
    kind: 'Deployment' | 'ReplicaSet',
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'HorizontalPodAutoscaler') return n;
        const spec = n.data.resource.spec as
            | { scaleTargetRef?: { kind?: string; name?: string } }
            | undefined;
        const ref = spec?.scaleTargetRef;
        if (!ref || ref.kind !== kind || ref.name !== oldName) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { scaleTargetRef?: { name?: string } };
        if (clonedSpec.scaleTargetRef) {
            clonedSpec.scaleTargetRef.name = newName;
        }
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite VerticalPodAutoscaler spec.targetRef names when their target
 *  (Deployment/ReplicaSet/DaemonSet/Pod/Job/CronJob) is renamed. */
function renameVpaTargetReferences(
    nodes: Node<K8sNodeData>[],
    kind: 'Deployment' | 'ReplicaSet' | 'DaemonSet' | 'Pod' | 'Job' | 'CronJob',
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'VerticalPodAutoscaler') return n;
        const spec = n.data.resource.spec as
            | { targetRef?: { kind?: string; name?: string } }
            | undefined;
        const ref = spec?.targetRef;
        if (!ref || ref.kind !== kind || ref.name !== oldName) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { targetRef?: { name?: string } };
        if (clonedSpec.targetRef) {
            clonedSpec.targetRef.name = newName;
        }
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Pod-spec ConfigMap references when a ConfigMap is renamed (envFrom, env.valueFrom, volumes). */
function renameConfigMapReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'DaemonSet' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        if (!podSpec || !referencesConfigMap(podSpec, oldName)) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        rewriteConfigMapNames(clonedPodSpec, oldName, newName);
        return { ...n, data: { ...n.data, resource } };
    });
}

/** The Pod spec of a node: `spec` for Pods, `spec.template.spec` for workloads,
 *  `spec.jobTemplate.spec.template.spec` for CronJobs. */
function podSpecOfNode(
    kind: SupportedKind,
    spec: Record<string, any> | undefined
): Record<string, any> | undefined {
    if (!spec) return undefined;
    if (kind === 'Pod') return spec;
    if (kind === 'CronJob') return spec.jobTemplate?.spec?.template?.spec;
    return spec.template?.spec;
}

/** True when a Pod spec references the given ConfigMap by name anywhere. */
function referencesConfigMap(podSpec: Record<string, any>, name: string): boolean {
    return configMapRefNames(podSpec).includes(name);
}

/** All ConfigMap names a Pod spec references (envFrom, env.valueFrom, volumes). */
function configMapRefNames(podSpec: Record<string, any>): string[] {
    const names: string[] = [];
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container?.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.configMapRef?.name) names.push(envFrom.configMapRef.name);
        });
        (Array.isArray(container?.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.configMapKeyRef?.name) names.push(env.valueFrom.configMapKeyRef.name);
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.configMap?.name) names.push(volume.configMap.name);
    });
    return names;
}

/** Rewrite every ConfigMap reference inside a Pod spec from oldName to newName. */
function rewriteConfigMapNames(podSpec: Record<string, any>, oldName: string, newName: string) {
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.configMapRef?.name === oldName) envFrom.configMapRef.name = newName;
        });
        (Array.isArray(container.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.configMapKeyRef?.name === oldName) {
                env.valueFrom.configMapKeyRef.name = newName;
            }
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.configMap?.name === oldName) volume.configMap.name = newName;
    });
}

/**
 * Rewrite Secret references when a Secret is renamed: Pod-spec references
 * (envFrom[].secretRef, env[].valueFrom.secretKeyRef, volumes[].secret.secretName)
 * and Ingress spec.tls[].secretName.
 */
function renameSecretReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind === 'Ingress') {
            const spec = n.data.resource.spec as
                | { tls?: Array<{ secretName?: string }> }
                | undefined;
            if (!spec?.tls?.some((tls) => tls?.secretName === oldName)) return n;
            const resource = structuredClone(n.data.resource);
            const clonedSpec = resource.spec as { tls?: Array<{ secretName?: string }> };
            (Array.isArray(clonedSpec.tls) ? clonedSpec.tls : []).forEach((tls) => {
                if (tls?.secretName === oldName) tls.secretName = newName;
            });
            return { ...n, data: { ...n.data, resource } };
        }
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'DaemonSet' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        if (!podSpec || !referencesSecret(podSpec, oldName)) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        rewriteSecretNames(clonedPodSpec, oldName, newName);
        return { ...n, data: { ...n.data, resource } };
    });
}

/** True when a Pod spec references the given Secret by name anywhere. */
function referencesSecret(podSpec: Record<string, any>, name: string): boolean {
    return secretRefNames(podSpec).includes(name);
}

/** All Secret names a Pod spec references (envFrom, env.valueFrom, volumes). */
function secretRefNames(podSpec: Record<string, any>): string[] {
    const names: string[] = [];
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container?.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.secretRef?.name) names.push(envFrom.secretRef.name);
        });
        (Array.isArray(container?.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.secretKeyRef?.name) names.push(env.valueFrom.secretKeyRef.name);
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.secret?.secretName) names.push(volume.secret.secretName);
    });
    return names;
}

/** Rewrite every Secret reference inside a Pod spec from oldName to newName. */
function rewriteSecretNames(podSpec: Record<string, any>, oldName: string, newName: string) {
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.secretRef?.name === oldName) envFrom.secretRef.name = newName;
        });
        (Array.isArray(container.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.secretKeyRef?.name === oldName) {
                env.valueFrom.secretKeyRef.name = newName;
            }
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.secret?.secretName === oldName) volume.secret.secretName = newName;
    });
}

/** Rewrite Pod-spec PersistentVolumeClaim references when a PVC is renamed (volumes[].persistentVolumeClaim.claimName). */
function renamePvcReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'DaemonSet' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        const referencesPvc = Array.isArray(podSpec?.volumes) && podSpec.volumes.some(
            (v: any) => v?.persistentVolumeClaim?.claimName === oldName
        );
        if (!referencesPvc) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        (Array.isArray(clonedPodSpec.volumes) ? clonedPodSpec.volumes : []).forEach((volume: any) => {
            if (volume?.persistentVolumeClaim?.claimName === oldName) {
                volume.persistentVolumeClaim.claimName = newName;
            }
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite PVC spec.volumeName references when a PV is renamed. */
function renamePvReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'PersistentVolumeClaim') return n;
        const spec = n.data.resource.spec as { volumeName?: string } | undefined;
        if (spec?.volumeName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { volumeName?: string };
        if (clonedSpec.volumeName === oldName) clonedSpec.volumeName = newName;
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite PVC spec.storageClassName references when a StorageClass is renamed. */
function renameStorageClassReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'PersistentVolumeClaim') return n;
        const spec = n.data.resource.spec as { storageClassName?: string } | undefined;
        if (spec?.storageClassName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { storageClassName?: string };
        if (clonedSpec.storageClassName === oldName) clonedSpec.storageClassName = newName;
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

/** Rewrite Gateway spec.gatewayClassName references when a GatewayClass is renamed. */
function renameGatewayClassReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Gateway') return n;
        const spec = n.data.resource.spec as { gatewayClassName?: string } | undefined;
        if (spec?.gatewayClassName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { gatewayClassName?: string };
        if (clonedSpec.gatewayClassName === oldName) clonedSpec.gatewayClassName = newName;
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Route spec.parentRefs[].name references when a Gateway is renamed. */
function renameGatewayReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (!isRouteKind(n.data.kind)) return n;
        const spec = n.data.resource.spec as { parentRefs?: Array<{ name?: string }> } | undefined;
        if (!spec?.parentRefs?.some((ref) => ref?.name === oldName)) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { parentRefs?: Array<{ name?: string }> };
        (Array.isArray(clonedSpec.parentRefs) ? clonedSpec.parentRefs : []).forEach((ref) => {
            if (ref?.name === oldName) ref.name = newName;
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Route spec.backendRefs[].name references when a Service is renamed. */
function renameRouteBackendReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (!isRouteKind(n.data.kind)) return n;
        const spec = n.data.resource.spec as { backendRefs?: Array<{ name?: string }> } | undefined;
        if (!spec?.backendRefs?.some((ref) => ref?.name === oldName)) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { backendRefs?: Array<{ name?: string }> };
        (Array.isArray(clonedSpec.backendRefs) ? clonedSpec.backendRefs : []).forEach((ref) => {
            if (ref?.name === oldName) ref.name = newName;
        });
        return { ...n, data: { ...n.data, resource } };
    });
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

/** Merge the given position entries into storage without touching other entries. */
function mergePositionsIntoStorage(
    entries: Array<{ key: string; value: { x: number; y: number } }>
) {
    if (!entries.length) return;
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        const positions: Record<string, { x: number; y: number }> = saved ? JSON.parse(saved) : {};
        entries.forEach(({ key, value }) => {
            positions[key] = value;
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

/** Rewrite a renamed DaemonSet's per-box RELATIVE pins (`DaemonSetBox:old:node` → `:new:node`). */
function renameDaemonSetBoxPins(oldName: string, newName: string) {
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        const prefix = `DaemonSetBox:${oldName}:`;
        let changed = false;
        Object.keys(positions).forEach((key) => {
            if (key.startsWith(prefix)) {
                positions[`DaemonSetBox:${newName}:${key.slice(prefix.length)}`] = positions[key];
                delete positions[key];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {}
}

/** Remove every saved DaemonSet box pin for the given DaemonSet (invariant 17:
 *  creation and deletion never inherit stale box positions). */
function clearDaemonSetBoxPins(dsName: string) {
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        const prefix = `DaemonSetBox:${dsName}:`;
        let changed = false;
        Object.keys(positions).forEach((key) => {
            if (key.startsWith(prefix)) {
                delete positions[key];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {}
}

/** Remove saved positions for the given `Kind:name` keys. Used so a re-created
 *  resource never inherits a stale pinned position from a previously deleted
 *  one — creation and namespace reassignment always get fresh, repaired
 *  placement (inside the namespace box, overlap-free, with growth). */
function clearSavedPositions(keys: string[]) {
    if (!keys.length) return;
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        let changed = false;
        keys.forEach((key) => {
            if (positions[key]) {
                delete positions[key];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {}
}

// ─── Namespace layout storage helpers ────────────────────────────────────────

/** The layout to edit: the persisted one, or a fresh auto-derivation from the
 *  current graph (so unedited layouts always hug the live nodes). Physical
 *  nodes are never auto-derived — a never-edited layout has none. */
function ensureNsLayout(state: VeltraState): NsLayout {
    if (state.nsLayout) return state.nsLayout;
    return (
        buildTeachingFrame(state.nodes) ?? {
            cluster: { ...DEFAULT_CLUSTER_RECT },
            nodes: [],
            namespaces: [],
        }
    );
}

/** The first free `worker-N` name for an auto-created physical node rect
 *  (never collides with existing rect names, whatever they are). */
function nextNodeName(layout: NsLayout, startIndex: number): string {
    const taken = new Set(layout.nodes.map((nd) => nd.name));
    let i = startIndex;
    let name = `worker-${i}`;
    while (taken.has(name)) {
        i += 1;
        name = `worker-${i}`;
    }
    return name;
}

/** The top-level real resources living in the given namespace, as rectangles —
 *  a namespace box can never shrink past its own resources. */
function namespaceContentRects(nodes: Node<K8sNodeData>[], name: string): Rect[] {
    return nodes
        .filter(
            (n) =>
                !n.parentId &&
                !n.data.synthetic &&
                !isClusterScoped(n.data.kind) &&
                (n.data.namespace ?? 'default') === name
        )
        .map((n) => ({
            x: n.position.x,
            y: n.position.y,
            width: typeof n.style?.width === 'number' ? n.style.width : FALLBACK_NODE_WIDTH,
            height: typeof n.style?.height === 'number' ? n.style.height : FALLBACK_NODE_HEIGHT,
        }));
}

export function readNsLayout(): NsLayout | null {
    try {
        const saved = localStorage.getItem(NS_LAYOUT_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        const isValidRect = (r: unknown): r is Rect =>
            !!r &&
            typeof (r as Rect).x === 'number' &&
            typeof (r as Rect).y === 'number' &&
            typeof (r as Rect).width === 'number' &&
            typeof (r as Rect).height === 'number';
        if (!isValidRect(parsed?.cluster)) return null;
        const isNamedRect = (r: unknown): r is NamespaceRect =>
            isValidRect(r) &&
            typeof (r as NamespaceRect).name === 'string' &&
            (r as NamespaceRect).name.length > 0;
        const namespaces = Array.isArray(parsed?.namespaces)
            ? (parsed.namespaces as unknown[]).filter(isNamedRect)
            : [];
        // Back-compat: layouts persisted before physical nodes existed have no
        // `nodes` key — treat it as an empty list instead of discarding the
        // whole layout (the cluster/namespaces are still valid).
        const nodes = Array.isArray(parsed?.nodes)
            ? (parsed.nodes as unknown[]).filter(isNamedRect)
            : [];
        return { cluster: parsed.cluster, nodes, namespaces };
    } catch {
        return null;
    }
}

function persistNsLayout(layout: NsLayout) {
    try {
        localStorage.setItem(NS_LAYOUT_KEY, JSON.stringify(layout));
    } catch (e) {
        console.error('Failed to save namespace layout to storage', e);
    }
}

/** Upsert a rectangle into a list of named rectangles (namespaces or physical
 *  nodes) — used for auto-discovered entries being edited for the first time. */
function upsertNamedRect<T extends { name: string }>(
    rects: T[],
    name: string,
    rect: Rect
): T[] {
    const idx = rects.findIndex((r) => r.name === name);
    if (idx >= 0) {
        const copy = [...rects];
        copy[idx] = { ...copy[idx], ...rect };
        return copy;
    }
    return [...rects, { name, ...rect } as unknown as T];
}
