import { type Node, type Edge } from '@xyflow/react';
import type { K8sResource } from '../types/types';
import type { K8sNodeData } from './graph/graphTypes';
import { createBuildGraphContext, getSavedPosition } from './graph/graphContext';
import { assignOwnership, materializeSynthetics } from './graph/simulation';
import { layoutWorkloads } from './graph/layoutWorkloads';
import { layoutAutoscalers, layoutIngresses, layoutServices } from './graph/layoutNetworkLanes';
import {
    layoutConfigMaps,
    layoutPvcs,
    layoutPvs,
    layoutSecrets,
    layoutStorageClasses,
} from './graph/layoutStorageLanes';
import { layoutGatewayApi } from './graph/layoutGatewayApi';
import { inferEdges } from './graph/inferEdges';

// Re-export the graph helpers so existing `../utils/buildGraph` importers keep working.
export * from './graph/graphTypes';
export * from './graph/kinds';
export * from './graph/selectors';
export * from './graph/autoscaling';
export * from './graph/podSpecRefs';
export * from './graph/networkRefs';

/**
 * Convert an array of parsed K8s resources into React Flow nodes with true nested containment.
 * - A Deployment with no matching ReplicaSet in the manifest gets a synthetic one
 *   (named `<name>-<hash>` like a real pod-template-hash RS).
 * - Every ReplicaSet (real or synthetic) materializes Pods up to `spec.replicas`,
 *   on top of any explicit Pods in the manifest that its selector claims.
 * - A CronJob always creates exactly ONE synthetic Job (named `<name>-<hash>`)
 *   from `spec.jobTemplate.spec`, which materializes Pods up to the template's
 *   parallelism.
 * - Synthetic resources are flagged `synthetic` + `managedBy` in node data; they are
 *   display-only and are never serialized back to YAML.
 *
 * Layout rules:
 * 1. Pods are nested inside ReplicaSets. Lay out in a 3-column grid. Compute ReplicaSet size.
 * 2. ReplicaSets are nested inside Deployments. Lay out horizontally in a row. Compute Deployment size.
 * 3. Services are placed in a lane above workloads (Y = 175). Auto-align horizontally above the Pods they select.
 * 4. Ingresses are placed in the top lane (Y = 25). Auto-align horizontally above the Services they target.
 * 5. HorizontalPodAutoscalers and VPAs share an autoscaler lane below workloads (Y = 520) with a
 *    single collision pass so the two kinds never overlap. Auto-align
 *    horizontally above the resource they scale (VPA via spec.targetRef, which
 *    may also point at a Pod/Job/CronJob).
 * 6. ConfigMaps are placed in a lane below HorizontalPodAutoscalers (Y = 680). They receive inferred
 *    "uses" edges from every workload whose Pod spec references them.
 * 7. PVCs are placed in a lane below ConfigMaps (Y = 840). They receive inferred
 *    "mounts" edges from every workload whose Pod spec claims them, plus a "binds"
 *    edge to the single PV (spec.volumeName) or StorageClass (spec.storageClassName)
 *    they reference: storage is explicit-only, no controller simulation.
 * 8. PVs are placed in a lane below PVCs (Y = 1000) and StorageClasses below PVs
 *    (Y = 1160).
 * 9. Secrets are placed in a lane below StorageClasses (Y = 1320). They receive
 *    inferred "uses" edges from every workload whose Pod spec references them
 *    (envFrom/secretKeyRef/volumes) and a "tls" edge from every Ingress whose
 *    spec.tls[].secretName points at them.
 * 10. Gateway API: GatewayClass (cluster-scoped, outside namespace boxes) and
 *    Gateway share a gateway lane (Y = 1480) with a single combined collision
 *    pass; all four route kinds (HTTPRoute/GRPCRoute/TCPRoute/TLSRoute) share a
 *    route lane (Y = 1640). Inferred edges: Gateway→GatewayClass "class"
 *    (spec.gatewayClassName), Route→Gateway "attaches" (spec.parentRefs[].name)
 *    and Route→Service "routes to" (spec.backendRefs[].name): explicit-only,
 *    a missing target draws nothing.
 * 11. Manual layout adjustments are preserved for all top-level elements.
 *
 * Invariants:
 * - Every Pod belongs to at most one ReplicaSet, every ReplicaSet to at most one Deployment
 *   (first match wins), so each resource is emitted exactly once.
 * - Node IDs are unique even when the manifest contains duplicate kind+name pairs.
 */
export function buildGraph(
    resources: K8sResource[],
    previousNodes: Node<K8sNodeData>[] = []
): {
    nodes: Node<K8sNodeData>[];
    edges: Edge[];
    /** IDs of top-level nodes positioned by auto-layout this pass (no previous or
     *  saved position). The placement repair pass may re-position exactly these.
     */
    autoPlacedIds: Set<string>;
} {
    const ctx = createBuildGraphContext(resources, previousNodes);

    assignOwnership(ctx);
    materializeSynthetics(ctx);

    layoutWorkloads(ctx);
    layoutServices(ctx);
    layoutIngresses(ctx);
    layoutAutoscalers(ctx);
    layoutConfigMaps(ctx);
    layoutPvcs(ctx);
    layoutPvs(ctx);
    layoutStorageClasses(ctx);
    layoutSecrets(ctx);
    layoutGatewayApi(ctx);

    const edges = inferEdges(ctx);

    // Which top-level nodes were placed by auto-layout this pass (no previous or
    // saved position for them), the placement repair pass may re-position exactly
    // these, never user-dragged/pinned nodes.
    const autoPlacedIds = new Set<string>();
    ctx.nodes.forEach((n) => {
        if (n.parentId) return;
        const key = `${n.data.kind}:${n.data.name}`;
        if (!ctx.prevCoords.has(key) && !getSavedPosition(n.data.kind, n.data.name)) {
            autoPlacedIds.add(n.id);
        }
    });

    return { nodes: ctx.nodes, edges, autoPlacedIds };
}
