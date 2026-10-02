import { type Edge, type Node } from '@xyflow/react';
import { applyHpaReplicaOverrides, buildGraph, type K8sNodeData } from '../utils/buildGraph';
import { resourcesToYaml } from '../utils/serializeYaml';
import { fileViewOf } from '../utils/fileTree';
import { repairPlacements } from '../utils/placement';
import type { NsLayout } from '../utils/teachingFrame';
import type { K8sResource, SupportedKind } from '../types/types';
import { YAML_KEY } from './constants';
import { persistNsLayout, persistUserEdges } from './persistence';
import { makeNotice, type CanvasNotice, type SelectedResource, type VeltraState } from './types';

/**
 * Merge inferred edges with the user's manual edges.
 * Drops manual edges whose endpoints no longer exist and manual edges that
 * duplicate an inferred relationship (either direction).
 */
export function mergeEdges(inferredEdges: Edge[], userEdges: Edge[], nodes: Node<K8sNodeData>[]): Edge[] {
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
export function managedGuardNotice(node: Node<K8sNodeData>): CanvasNotice {
    const owner = node.data.managedBy;
    const ownerDesc = owner ? `${owner.kind} ${owner.name}` : 'its controller';
    return makeNotice(
        'info',
        `${node.data.name} is managed by ${ownerDesc}; edit or delete the owner instead (scale replicas to change pod count).`
    );
}

/**
 * The single conversion from render nodes back to the authoritative resource list.
 * Controller-materialized (synthetic) nodes are display-only and never serialized.
 */
export function toResources(nodes: Node<K8sNodeData>[]): K8sResource[] {
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
    if (kind === 'Deployment' || kind === 'ReplicaSet') return 'apps/v1';
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

/** Collect a node and all of its nested descendants (parentId chain). */
export function collectWithDescendants(nodes: Node<K8sNodeData>[], rootId: string): Set<string> {
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
export function isAncestor(nodes: Node<K8sNodeData>[], ancestorId: string, nodeId: string): boolean {
    let current = nodes.find((n) => n.id === nodeId);
    while (current?.parentId) {
        if (current.parentId === ancestorId) return true;
        current = nodes.find((n) => n.id === current!.parentId);
    }
    return false;
}

/** Rebuild nodes/edges from resources and merge in the user's manual edges.
 *  Auto-placed nodes are then repaired into their namespace/cluster boxes,
 *  overlap-free, growing persisted boxes when they don't fit. */
export function deriveGraph(
    resources: K8sResource[],
    prevNodes: Node<K8sNodeData>[],
    userEdges: Edge[],
    nsLayout: NsLayout | null
) {
    const { nodes, edges: inferredEdges, autoPlacedIds } = buildGraph(
        resources,
        prevNodes
    );
    const placed = repairPlacements(nodes, autoPlacedIds, nsLayout);
    return {
        nodes: placed.nodes,
        inferredEdges,
        edges: mergeEdges(inferredEdges, userEdges, placed.nodes),
        ...(placed.layoutChanged ? { nsLayout: placed.nsLayout } : {}),
        layoutChanged: placed.layoutChanged,
    };
}

/**
 * Single commit path for every structural change coming from the canvas/inspector.
 * Rebuilds the graph, persists positions, and serializes YAML when sync is active.
 */
export function commitResources(
    state: VeltraState,
    resources: K8sResource[],
    prevNodes: Node<K8sNodeData>[],
    opts: { userEdges?: Edge[]; selectedResource?: SelectedResource | null; nsLayout?: NsLayout | null } = {}
): Partial<VeltraState> {
    const userEdges = opts.userEdges ?? state.userEdges;
    if (opts.userEdges) {
        persistUserEdges(userEdges);
    }
    // HorizontalPodAutoscaler priority: clamp each targeted workload's spec.replicas into the autoscaler's
    // [minReplicas, maxReplicas] window and write the clamped value back, so the
    // derived graph, the YAML serialization and the badges all agree.
    const hpaOverrides = applyHpaReplicaOverrides(resources);
    // Note: positions are only persisted when the user drags a node;
    // pinning auto-layout positions here would permanently disable
    // alignment and collision handling for every node after the first edit.
    const nsLayout = opts.nsLayout ?? state.nsLayout;
    const derived = deriveGraph(resources, prevNodes, userEdges, nsLayout);
    // A repair that grew a persisted namespace/cluster box is written back so
    // NS-mode edits start from the grown layout (auto layouts stay null).
    const { layoutChanged, ...derivedRest } = derived;
    if (layoutChanged && derived.nsLayout) {
        persistNsLayout(derived.nsLayout);
    }

    const result: Partial<VeltraState> = { ...derivedRest, userEdges, hpaOverrides };
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
}
