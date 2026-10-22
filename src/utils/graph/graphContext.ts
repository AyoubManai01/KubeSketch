import { type Node } from '@xyflow/react';
import type { K8sResource, SupportedKind } from '../../types/types';
import type { K8sNodeData } from './graphTypes';
import { nodeIdFor } from './kinds';
import { replicasOf } from './selectors';
import { effectiveReplicas, hpaTargets } from './autoscaling';

/**
 * Shared state threaded through the buildGraph phases: the kind partitions,
 * the ownership/simulation maps, the node accumulators and the small closures
 * (allocateId / syntheticMeta / effectiveReplicasOf / desiredReplicasFor)
 * that several phases call. Phase functions mutate it in place.
 */
export interface BuildGraphContext {
    resources: K8sResource[];
    prevCoords: Map<string, { x: number; y: number }>;
    // Kind partitions
    ingresses: K8sResource[];
    services: K8sResource[];
    deployments: K8sResource[];
    replicaSets: K8sResource[];
    pods: K8sResource[];
    hpas: K8sResource[];
    vpas: K8sResource[];
    configmaps: K8sResource[];
    pvcs: K8sResource[];
    pvs: K8sResource[];
    storageClasses: K8sResource[];
    secrets: K8sResource[];
    jobs: K8sResource[];
    cronJobs: K8sResource[];
    gatewayClasses: K8sResource[];
    gateways: K8sResource[];
    routes: K8sResource[];
    // Ownership maps (filled by assignOwnership / materializeSynthetics)
    claimedRs: Set<K8sResource>;
    depToRs: Map<K8sResource, K8sResource[]>;
    claimedPods: Set<K8sResource>;
    rsToPod: Map<K8sResource, K8sResource[]>;
    claimedJobPods: Set<K8sResource>;
    jobToPod: Map<K8sResource, K8sResource[]>;
    cronToJob: Map<K8sResource, K8sResource>;
    syntheticOwner: Map<K8sResource, { kind: SupportedKind; name: string }>;
    syntheticRs: K8sResource[];
    syntheticCronJobs: K8sResource[];
    allPods: K8sResource[];
    standaloneRs: K8sResource[];
    standalonePods: K8sResource[];
    // Node accumulators
    absCoords: Map<string, { x: number; y: number }>;
    nodes: Node<K8sNodeData>[];
    usedIds: Set<string>;
    idByResource: Map<K8sResource, string>;
    // Closures shared by the phases
    allocateId(resource: K8sResource): string;
    syntheticMeta(resource: K8sResource): Partial<K8sNodeData>;
    effectiveReplicasOf(resource: K8sResource): number;
    desiredReplicasFor(rs: K8sResource): number;
    // Set by layoutServices, read by layoutIngresses and the edge pass
    serviceIdByName: Map<string, string>;
}

/**
 * Helper to fetch a node's saved position from localStorage.
 * Used on initial load to preserve manual drag positions.
 */
export function getSavedPosition(kind: string, name: string): { x: number; y: number } | null {
    try {
        const saved = localStorage.getItem('kubesketch_node_positions');
        if (saved) {
            const parsed = JSON.parse(saved);
            const pos = parsed[`${kind}:${name}`];
            if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
                return pos;
            }
        }
    } catch {}
    return null;
}

/** Inferred edge stroke color by source kind: HorizontalPodAutoscaler scaling (amber), Ingress routes (purple), Jobs (yellow), CronJobs (fuchsia), everything else (blue). */
export function edgeColorFor(kind: string): string {
    if (kind === 'HorizontalPodAutoscaler') return '#f59e0b';
    if (kind === 'VerticalPodAutoscaler') return '#0ea5e9';
    if (kind === 'Ingress') return '#a78bfa';
    if (kind === 'Job') return '#eab308';
    if (kind === 'CronJob') return '#d946ef';
    return '#60a5fa';
}

/**
 * Inferred edge stroke color for a source→target pair. Storage edges are colored by
 * their TARGET kind (like ConfigMap "uses" edges): mounts into a PVC are pink, PVC→PV
 * binds lime, PVC→StorageClass binds indigo. Everything else falls back to the source
 * kind color.
 */
export function edgeColorForPair(sourceKind: string, targetKind: string): string {
    if (targetKind === 'PersistentVolumeClaim') return '#ec4899';
    if (targetKind === 'PersistentVolume') return '#84cc16';
    if (targetKind === 'StorageClass') return '#6366f1';
    if (targetKind === 'ConfigMap') return '#06b6d4';
    if (targetKind === 'Secret' && sourceKind === 'Ingress') return '#eab308';
    if (targetKind === 'Secret') return '#dc2626';
    if (targetKind === 'GatewayClass') return '#f43f5e';
    if (sourceKind === 'HTTPRoute') return '#0d9488';
    if (sourceKind === 'GRPCRoute') return '#65a30d';
    if (sourceKind === 'TCPRoute') return '#0284c7';
    if (sourceKind === 'TLSRoute') return '#d97706';
    if (sourceKind === 'UDPRoute') return '#16a34a';
    if (sourceKind === 'Gateway') return '#7c3aed';
    return edgeColorFor(sourceKind);
}

/**
 * 1D Collision Resolution Pass
 * Keeps nodes from overlapping by pushing movable nodes rightward, treating
 * user-positioned nodes as immovable anchors that movable nodes must clear.
 */
export function resolveCollisions(
    items: Array<{ id: string; x: number; width: number }>,
    fixedIds: Set<string>,
    gap: number
) {
    if (items.length <= 1) return;

    // Sort by X coordinate
    items.sort((a, b) => a.x - b.x);

    const fixedItems = items.filter((i) => fixedIds.has(i.id));
    let frontier = -Infinity;

    for (const item of items) {
        if (fixedIds.has(item.id)) {
            frontier = Math.max(frontier, item.x + item.width + gap);
            continue;
        }
        let x = Math.max(item.x, frontier);
        // Clear any fixed anchor the candidate slot would overlap
        let moved = true;
        while (moved) {
            moved = false;
            for (const fixed of fixedItems) {
                if (x < fixed.x + fixed.width + gap && x + item.width + gap > fixed.x) {
                    x = fixed.x + fixed.width + gap;
                    moved = true;
                }
            }
        }
        item.x = x;
        frontier = x + item.width + gap;
    }
}

/**
 * Build the shared phase context: previous coordinates, kind partitions, the
 * empty ownership/accumulator maps and the closures every phase calls.
 */
export function createBuildGraphContext(
    resources: K8sResource[],
    previousNodes: Node<K8sNodeData>[]
): BuildGraphContext {
    // Map previous node coordinates by key
    const prevCoords = new Map<string, { x: number; y: number }>();
    previousNodes.forEach((node) => {
        if (!node.parentId) {
            prevCoords.set(`${node.data.kind}:${node.data.name}`, node.position);
        }
    });

    // Separate resources by kind
    const ingresses = resources.filter((r) => r.kind === 'Ingress');
    const services = resources.filter((r) => r.kind === 'Service');
    const deployments = resources.filter((r) => r.kind === 'Deployment');
    const replicaSets = resources.filter((r) => r.kind === 'ReplicaSet');
    const pods = resources.filter((r) => r.kind === 'Pod');
    const hpas = resources.filter((r) => r.kind === 'HorizontalPodAutoscaler');
    const vpas = resources.filter((r) => r.kind === 'VerticalPodAutoscaler');
    const configmaps = resources.filter((r) => r.kind === 'ConfigMap');
    const pvcs = resources.filter((r) => r.kind === 'PersistentVolumeClaim');
    const pvs = resources.filter((r) => r.kind === 'PersistentVolume');
    const storageClasses = resources.filter((r) => r.kind === 'StorageClass');
    const secrets = resources.filter((r) => r.kind === 'Secret');
    const jobs = resources.filter((r) => r.kind === 'Job');
    const cronJobs = resources.filter((r) => r.kind === 'CronJob');
    const gatewayClasses = resources.filter((r) => r.kind === 'GatewayClass');
    const gateways = resources.filter((r) => r.kind === 'Gateway');
    const httpRoutes = resources.filter((r) => r.kind === 'HTTPRoute');
    const grpcRoutes = resources.filter((r) => r.kind === 'GRPCRoute');
    const tcpRoutes = resources.filter((r) => r.kind === 'TCPRoute');
    const tlsRoutes = resources.filter((r) => r.kind === 'TLSRoute');
    const udpRoutes = resources.filter((r) => r.kind === 'UDPRoute');
    const routes = [...httpRoutes, ...grpcRoutes, ...tcpRoutes, ...tlsRoutes, ...udpRoutes];

    /** synthetic resource → its nearest REAL controlling resource */
    const syntheticOwner = new Map<K8sResource, { kind: SupportedKind; name: string }>();

    // Keep track of all absolute coordinates for aligning Services/Ingresses
    const absCoords = new Map<string, { x: number; y: number }>();

    // Final nodes accumulator
    const nodes: Node<K8sNodeData>[] = [];

    // Node ID allocation: unique even for duplicate kind+name resources
    const usedIds = new Set<string>();
    const idByResource = new Map<K8sResource, string>();

    const ctx: BuildGraphContext = {
        resources,
        prevCoords,
        ingresses,
        services,
        deployments,
        replicaSets,
        pods,
        hpas,
        vpas,
        configmaps,
        pvcs,
        pvs,
        storageClasses,
        secrets,
        jobs,
        cronJobs,
        gatewayClasses,
        gateways,
        routes,
        claimedRs: new Set<K8sResource>(),
        depToRs: new Map<K8sResource, K8sResource[]>(),
        claimedPods: new Set<K8sResource>(),
        rsToPod: new Map<K8sResource, K8sResource[]>(),
        claimedJobPods: new Set<K8sResource>(),
        jobToPod: new Map<K8sResource, K8sResource[]>(),
        cronToJob: new Map<K8sResource, K8sResource>(),
        syntheticOwner,
        syntheticRs: [],
        syntheticCronJobs: [],
        allPods: [],
        standaloneRs: [],
        standalonePods: [],
        absCoords,
        nodes,
        usedIds,
        idByResource,
        serviceIdByName: new Map<string, string>(),
        allocateId: undefined as never,
        syntheticMeta: undefined as never,
        effectiveReplicasOf: undefined as never,
        desiredReplicasFor: undefined as never,
    };

    ctx.allocateId = (resource: K8sResource) => {
        const base = nodeIdFor(resource.kind, resource.metadata.name);
        let id = base;
        let n = 2;
        while (ctx.usedIds.has(id)) id = `${base}#${n++}`;
        ctx.usedIds.add(id);
        ctx.idByResource.set(resource, id);
        return id;
    };

    /** synthetic/managedBy node-data fragment for a resource (empty for real resources). */
    ctx.syntheticMeta = (resource: K8sResource): Partial<K8sNodeData> => {
        const owner = ctx.syntheticOwner.get(resource);
        return owner ? { synthetic: true, managedBy: owner } : {};
    };

    /**
     * The effective replica count of a workload under HorizontalPodAutoscaler priority:
     * clamp(spec.replicas, [minReplicas, maxReplicas]) of the first HorizontalPodAutoscaler that
     * targets it. The store has already written the clamped value back into
     * spec.replicas, so this mostly returns replicasOf(). The fallback keeps
     * materialization correct even when buildGraph runs pre-override.
     */
    ctx.effectiveReplicasOf = (resource: K8sResource): number => {
        for (const hpa of ctx.hpas) {
            const effective = effectiveReplicas(hpa, resource);
            if (effective !== undefined) return effective;
        }
        return replicasOf(resource);
    };

    /** A ReplicaSet inside a HorizontalPodAutoscaler-scaled Deployment materializes to the Deployment's
     *  effective count (the Deployment controller drives its ReplicaSets' scale). */
    ctx.desiredReplicasFor = (rs: K8sResource): number => {
        const ownerDep = ctx.deployments.find((dep) => ctx.depToRs.get(dep)?.includes(rs));
        if (ownerDep && ctx.hpas.some((hpa) => hpaTargets(hpa, ownerDep))) {
            return ctx.effectiveReplicasOf(ownerDep);
        }
        return ctx.effectiveReplicasOf(rs);
    };

    return ctx;
}
