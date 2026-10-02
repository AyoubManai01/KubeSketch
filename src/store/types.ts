import { type Connection, type Edge, type EdgeChange, type Node } from '@xyflow/react';
import type { HpaReplicaOverride, K8sNodeData } from '../utils/buildGraph';
import type { ConfigMapMechanism, SecretMechanism } from '../utils/linkResources';
import type { NsLayout, Rect } from '../utils/teachingFrame';
import type { K8sResource, SupportedKind } from '../types/types';

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
    target: { kind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/** Target + mechanism for writing a ConfigMap reference (create-modal path). */
export interface ConfigMapLinkPayload {
    targetKind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob';
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
    target: { kind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/** Target + mechanism for writing a Secret reference (create-modal path). */
export interface SecretLinkPayload {
    targetKind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob';
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
 * than one replica: identical Pods cannot share a single-node claim.
 */
export interface PendingPvcLink {
    pvc: { name: string };
    target: { kind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string };
}

/**
 * Optional links for a newly created PVC (create-modal path): a mount target (a
 * Pod, Deployment or ReplicaSet to claim it from, with the volume name; workloads
 * get the reference in their Pod template) and exactly one bind target, a PV or
 * a StorageClass. Setting one bind kind clears the other field on the PVC.
 */
export interface PvcLinkPayload {
    mountTarget?: { kind: 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob'; name: string; volumeName: string };
    bindTarget?: { kind: 'PersistentVolume' | 'StorageClass'; name: string };
}

let noticeSeq = 0;
export const makeNotice = (tone: CanvasNotice['tone'], text: string): CanvasNotice => ({
    id: ++noticeSeq,
    tone,
    text,
});

/** The data fields of the store (everything except the action methods). */
export interface VeltraStateFields {
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

    /** Currently selected resource: single source of truth for editor highlight + inspector */
    selectedResource: SelectedResource | null;

    /** Syntax/validation error message if YAML parsing fails */
    yamlError: string | null;

    /** Latest transient feedback message (auto-dismissed by the canvas toast). */
    notice: CanvasNotice | null;

    /** Active HorizontalPodAutoscaler replica clamps from the last commit; drives the bottom status bar. */
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

    /** Cluster + namespace rectangles (positions/sizes). Null until the user
     *  edits them; the rendered layout then derives from the live graph every
     *  time. Persisted on exit of namespace editing. */
    nsLayout: NsLayout | null;

    /** VSCode-style file explorer mode: the editor pane becomes an explorer
     *  sidebar + a per-file editor (a projection of the single YAML manifest). */
    fileExplorerMode: boolean;

    /** The active virtual file path (e.g. `default/my-app/deployment.yaml`). */
    activeFile: string | null;

    /** Raw editor text of the active file; the file view is a scoped editor, so
     *  unlike `yaml` this is only re-serialized when the model changes externally. */
    activeFileText: string;

    /** Syntax/validation error from the scoped file editor (invalid YAML keeps
     *  the last good model and the canvas untouched). */
    fileYamlError: string | null;
}

/** The zustand setter/getter shapes the action factories receive. */
export type StoreSetter = {
    (partial: Partial<VeltraState>): void;
    (updater: (state: VeltraState) => Partial<VeltraState>): void;
};
export type StoreGetter = () => VeltraState;

export interface VeltraState extends VeltraStateFields {
    setNotice: (notice: CanvasNotice | null) => void;
    setYaml: (value: string) => void;
    /** Structural node changes coming from React Flow (e.g. keyboard delete). */
    setCanvasNodes: (nodes: Node<K8sNodeData>[]) => void;
    /** Position/selection/dimension-only updates during drag; never touches the model or YAML. */
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
        link?: ConfigMapLinkPayload | PvcLinkPayload | SecretLinkPayload | IngressTlsPayload
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
     *  resource living in it (K8s-style). No namespace is protected. */
    deleteNamespace: (name: string) => void;
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
