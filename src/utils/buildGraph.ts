import { type Node, type Edge, MarkerType } from '@xyflow/react';
import type { K8sResource, SupportedKind } from '../types/types';

/** Data payload we attach to each React Flow node */
export interface K8sNodeData {
    kind: SupportedKind;
    name: string;
    namespace?: string;
    resource: K8sResource;
    /** True for controller-managed resources Veltra materializes (like a real cluster
     *  creating a Deployment's ReplicaSet and Pods). Never serialized back to YAML. */
    synthetic?: boolean;
    /** For synthetic resources: the nearest REAL resource that controls them. */
    managedBy?: { kind: SupportedKind; name: string };
    [key: string]: unknown;
}

// Dimensions configuration
const POD_WIDTH = 150;
const POD_HEIGHT = 110; // fits header + namespace/container/image rows without overflowing the parent
const SERVICE_HEIGHT = 104;
const INGRESS_HEIGHT = 104;
const HPA_WIDTH = 175;
const HPA_HEIGHT = 104; // fits header + target/min/max rows without overflowing
const VPA_WIDTH = 185;
const VPA_HEIGHT = 104; // fits header + target/updateMode rows without overflowing
const CONFIGMAP_WIDTH = 180;
const CONFIGMAP_HEIGHT = 104; // fits header + data rows without overflowing the leaf box
const PVC_WIDTH = 175;
const PVC_HEIGHT = 124; // fits header + accessModes/storage/binding rows without overflowing the leaf box
const PV_WIDTH = 175;
const PV_HEIGHT = 124;
const STORAGECLASS_WIDTH = 185;
const STORAGECLASS_HEIGHT = 124;
const SECRET_WIDTH = 180;
const SECRET_HEIGHT = 104; // fits header + data rows without overflowing the leaf box
const JOB_WIDTH = 180;
const JOB_HEIGHT = 124; // fits header + restart/parallelism/completions rows without overflowing the leaf box
const CRONJOB_WIDTH = 185;
const CRONJOB_HEIGHT = 150; // fits header + schedule/parallelism/completions/container/image rows without overflowing the leaf box
const RS_HEADER_HEIGHT = 45;
const DEP_HEADER_HEIGHT = 45;

const RS_PADDING = { top: 10, left: 16, right: 16, bottom: 16 };
const DEP_PADDING = { top: 15, left: 20, right: 20, bottom: 20 };

const POD_GAP = 12;
const RS_GAP = 20;
const WORKLOAD_GAP = 48;

const GATEWAYCLASS_WIDTH = 185;
const GATEWAYCLASS_HEIGHT = 124; // fits header + controllerName rows without overflowing the leaf box
const GATEWAY_WIDTH = 185;
const GATEWAY_HEIGHT = 124; // fits header + class/listener rows without overflowing the leaf box
const ROUTE_WIDTH = 180;
const ROUTE_HEIGHT = 124; // fits header + parent/backend/host rows without overflowing the leaf box

/** True for the Gateway API family kinds (GatewayClass / Gateway / route kinds). */
export function isGatewayApiKind(kind: string): boolean {
    return (
        kind === 'GatewayClass' ||
        kind === 'Gateway' ||
        kind === 'HTTPRoute' ||
        kind === 'GRPCRoute' ||
        kind === 'TCPRoute' ||
        kind === 'TLSRoute' ||
        kind === 'UDPRoute'
    );
}

/** Presentational grouping of resource kinds for the canvas toolbar. */
export function kindGroupLabel(kind: string): string {
    if (kind === 'Deployment' || kind === 'Pod' || kind === 'ReplicaSet' || kind === 'HPA' ||
        kind === 'VerticalPodAutoscaler' || kind === 'Job' || kind === 'CronJob') {
        return 'Workload';
    }
    if (kind === 'Service' || kind === 'Ingress' || isGatewayApiKind(kind)) {
        return 'Network';
    }
    if (kind === 'PersistentVolume' || kind === 'PersistentVolumeClaim' || kind === 'StorageClass') {
        return 'Storage';
    }
    if (kind === 'ConfigMap' || kind === 'Secret') {
        return 'Configuration';
    }
    return 'Other';
}

/** True for Gateway API route kinds (HTTPRoute / GRPCRoute / TCPRoute / TLSRoute / UDPRoute). */
export function isRouteKind(kind: string): boolean {
    return (
        kind === 'HTTPRoute' ||
        kind === 'GRPCRoute' ||
        kind === 'TCPRoute' ||
        kind === 'TLSRoute' ||
        kind === 'UDPRoute'
    );
}

/**
 * Collect the connected Gateway API family of a resource: the GatewayClass, every
 * Gateway referencing it (spec.gatewayClassName) and every Route attached to those
 * Gateways (spec.parentRefs[].name). Traversed through the semantic references, not
 * the parentId nesting chain (Gateway API resources are top-level siblings). Services
 * in a Route's backendRefs are intentionally NEVER collected — a Route routes TO a
 * Service, it does not own it, so the Service always survives the family cascade.
 */
export function collectGatewayApiFamily(nodes: Node<K8sNodeData>[], rootId: string): Set<string> {
    const doomed = new Set<string>();
    const root = nodes.find((n) => n.id === rootId);
    if (!root || !isGatewayApiKind(root.data.kind)) return doomed;

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const queue: Node<K8sNodeData>[] = [root];
    while (queue.length) {
        const cur = queue.shift()!;
        if (doomed.has(cur.id)) continue;
        doomed.add(cur.id);
        const kind = cur.data.kind;
        const name = cur.data.name;
        if (kind === 'GatewayClass') {
            // down: every Gateway whose spec.gatewayClassName points at this class
            nodes
                .filter(
                    (n) =>
                        n.data.kind === 'Gateway' &&
                        (n.data.resource.spec as { gatewayClassName?: string } | undefined)
                            ?.gatewayClassName === name
                )
                .forEach((g) => queue.push(g));
        } else if (kind === 'Gateway') {
            // up: the class this Gateway references; down: Routes attached to it
            const spec = cur.data.resource.spec as { gatewayClassName?: string } | undefined;
            if (spec?.gatewayClassName) {
                const gc = byId.get(nodeIdFor('GatewayClass', spec.gatewayClassName));
                if (gc) queue.push(gc);
            }
            nodes
                .filter(
                    (n) =>
                        isRouteKind(n.data.kind) &&
                        (n.data.resource.spec as { parentRefs?: Array<{ name?: string }> } | undefined)
                            ?.parentRefs?.some((ref) => ref?.name === name)
                )
                .forEach((r) => queue.push(r));
        } else {
            // up: the Gateway(s) this Route attaches to via parentRefs
            const spec = cur.data.resource.spec as { parentRefs?: Array<{ name?: string }> } | undefined;
            (spec?.parentRefs ?? []).forEach((ref) => {
                if (!ref?.name) return;
                const gw = byId.get(nodeIdFor('Gateway', ref.name));
                if (gw) queue.push(gw);
            });
        }
    }
    return doomed;
}

/** Upper bound on materialized Pods per ReplicaSet — keeps huge replica counts renderable.
 *  The replica badge on the workload always shows the true desired count. */
export const MAX_SYNTHETIC_PODS = 15;

/** Canonical React Flow node ID for a resource. Kept stable and derivable everywhere. */
export function nodeIdFor(kind: string, name: string): string {
    return `${kind}-${name}`;
}

/** Deterministic pod-template-hash-style suffix so synthetic names are stable across rebuilds. */
function shortHash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    }
    return h.toString(36).slice(0, 5).padEnd(5, '0');
}

/** Desired replica count of a workload (Kubernetes defaults to 1 when unset). */
export function replicasOf(resource: K8sResource): number {
    const spec = resource.spec as { replicas?: unknown } | undefined;
    const n = spec?.replicas;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n);
    return 1;
}

/** Number of Pods a Job runs at the same time (spec.parallelism, defaults to 1 when unset). */
export function parallelismOf(resource: K8sResource): number {
    const spec = resource.spec as { parallelism?: unknown } | undefined;
    const n = spec?.parallelism;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

/** Number of Pods a CronJob's Job runs at the same time (spec.jobTemplate.spec.parallelism, defaults to 1 when unset). */
export function cronParallelismOf(resource: K8sResource): number {
    const spec = resource.spec as { jobTemplate?: { spec?: { parallelism?: unknown } } } | undefined;
    const n = spec?.jobTemplate?.spec?.parallelism;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

/**
 * Access modes that bind a claim to a single node (ReadWriteOnce / ReadWriteOncePod).
 * Such a PVC cannot be mounted by every Pod of a multi-replica workload — identical
 * Pods of a Deployment/ReplicaSet all claim the same volume, and only one node may
 * attach it. ReadOnlyMany / ReadWriteMany are node-shareable and always allowed.
 */
const SINGLE_NODE_ACCESS_MODES = new Set(['ReadWriteOnce', 'ReadWriteOncePod']);

/** True when the PVC's first access mode is single-node (RWO/RWOP). */
export function isSingleNodeAccessMode(pvc: K8sResource): boolean {
    const spec = pvc.spec as { accessModes?: unknown } | undefined;
    const modes = spec?.accessModes;
    const first = Array.isArray(modes) ? modes[0] : modes;
    return typeof first === 'string' && SINGLE_NODE_ACCESS_MODES.has(first);
}

/** One HPA-enforced replica clamp on a workload (or on a ReplicaSet inherited from its Deployment). */
export interface HpaReplicaOverride {
    kind: 'Deployment' | 'ReplicaSet';
    name: string;
    original: number;
    effective: number;
    hpaName: string;
    /** Which bound forced the change (for the warning text). */
    reason: 'minReplicas' | 'maxReplicas';
    bound: number;
    /** Set when a ReplicaSet inherited the count from its Deployment's HPA. */
    viaDeployment?: string;
}

/** The lower/upper bounds an HPA enforces on a workload (min defaults to 1, max to Infinity). */
function hpaBounds(hpa: K8sResource): { min: number; max: number } | undefined {
    const spec = hpa.spec as { minReplicas?: unknown; maxReplicas?: unknown } | undefined;
    const minRaw = spec?.minReplicas;
    const maxRaw = spec?.maxReplicas;
    const min =
        typeof minRaw === 'number' && Number.isFinite(minRaw) && minRaw >= 0
            ? Math.floor(minRaw)
            : 1;
    const max =
        typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 0
            ? Math.floor(maxRaw)
            : Infinity;
    return { min, max: Math.max(max, min) };
}

/** True when the HPA's scaleTargetRef points at this exact workload. */
function hpaTargets(hpa: K8sResource, resource: K8sResource): boolean {
    const target = getHpaTarget(hpa);
    return !!target && target.kind === resource.kind && target.name === resource.metadata.name;
}

/** The effective replica count an HPA forces onto a workload: clamp(spec.replicas, [min, max]). */
export function effectiveReplicas(hpa: K8sResource, resource: K8sResource): number | undefined {
    const bounds = hpaBounds(hpa);
    if (!bounds || !hpaTargets(hpa, resource)) return undefined;
    return Math.min(Math.max(replicasOf(resource), bounds.min), bounds.max);
}

/**
 * HPA priority over `spec.replicas` (HorizontalPodAutoscalers win over Deployments
 * and ReplicaSets). Clamps every targeted workload's replicas into the HPA's
 * [minReplicas, maxReplicas] window and WRITES the clamped value back into the
 * workload's spec — YAML, canvas pod count and badges all agree afterwards.
 *
 * A Deployment's HPA also propagates the effective count to the ReplicaSets it
 * owns (the Deployment controller drives its ReplicaSets' scale). The first
 * matching HPA wins per workload. Returns the clamps that actually changed a
 * count (used for the persistent bottom status-bar warning).
 */
export function applyHpaReplicaOverrides(resources: K8sResource[]): HpaReplicaOverride[] {
    const hpas = resources.filter((r) => r.kind === 'HPA');
    if (hpas.length === 0) return [];
    const overrides: HpaReplicaOverride[] = [];

    const clampTo = (
        resource: K8sResource,
        hpa: K8sResource,
        effective: number,
        viaDeployment?: string
    ): void => {
        const original = replicasOf(resource);
        if (effective === original) return;
        const bounds = hpaBounds(hpa)!;
        const reason: HpaReplicaOverride['reason'] =
            effective < original ? 'maxReplicas' : 'minReplicas';
        const bound = reason === 'minReplicas' ? bounds.min : bounds.max;
        const spec = resource.spec as { replicas?: unknown };
        spec.replicas = effective;
        overrides.push({
            kind: resource.kind as 'Deployment' | 'ReplicaSet',
            name: resource.metadata.name,
            original,
            effective,
            hpaName: hpa.metadata.name,
            reason,
            bound,
            viaDeployment,
        });
    };

    resources.forEach((resource) => {
        if (resource.kind !== 'Deployment' && resource.kind !== 'ReplicaSet') return;
        for (const hpa of hpas) {
            const effective = effectiveReplicas(hpa, resource);
            if (effective === undefined) continue;
            clampTo(resource, hpa, effective);
            if (resource.kind === 'Deployment') {
                const depEffective = effective;
                resources.forEach((rs) => {
                    if (rs.kind !== 'ReplicaSet' || !ownsResource(resource, rs)) return;
                    clampTo(rs, hpa, depEffective, resource.metadata.name);
                });
            }
            break; // first matching HPA wins
        }
    });
    return overrides;
}

/** The ReplicaSet a real cluster would create for a Deployment. */
function synthesizeReplicaSet(dep: K8sResource, replicas?: number): K8sResource {
    const spec = dep.spec as { template?: unknown } | undefined;
    const podLabels = getWorkloadPodLabels(dep) ?? { app: dep.metadata.name };
    return {
        apiVersion: 'apps/v1',
        kind: 'ReplicaSet',
        metadata: {
            name: `${dep.metadata.name}-${shortHash(dep.metadata.name)}`,
            ...(dep.metadata.namespace ? { namespace: dep.metadata.namespace } : {}),
            labels: { ...podLabels },
        },
        spec: {
            replicas: replicas ?? replicasOf(dep),
            selector: { matchLabels: { ...podLabels } },
            ...(spec?.template ? { template: structuredClone(spec.template) } : {}),
        },
    };
}

/** One of the Pods a real cluster would run for a ReplicaSet. */
function synthesizePod(rs: K8sResource, name: string): K8sResource {
    const spec = rs.spec as { template?: { spec?: unknown } } | undefined;
    const labels = getWorkloadPodLabels(rs) ?? { app: rs.metadata.name };
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name,
            ...(rs.metadata.namespace ? { namespace: rs.metadata.namespace } : {}),
            labels: { ...labels },
        },
        spec: spec?.template?.spec ? structuredClone(spec.template.spec) : {},
    };
}

/**
 * The Job a real cluster's CronJob controller would create for its next scheduled
 * run. The Job's spec is the CronJob's `spec.jobTemplate.spec` — a CronJob never
 * links to an existing Job, it always creates its own.
 */
function synthesizeJob(cron: K8sResource): K8sResource {
    const spec = cron.spec as { jobTemplate?: { spec?: unknown } } | undefined;
    const podLabels = getWorkloadPodLabels(cron) ?? { app: cron.metadata.name };
    return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
            name: `${cron.metadata.name}-${shortHash(cron.metadata.name)}`,
            ...(cron.metadata.namespace ? { namespace: cron.metadata.namespace } : {}),
            labels: { ...podLabels },
        },
        spec: spec?.jobTemplate?.spec
            ? structuredClone(spec.jobTemplate.spec)
            : {
                  template: {
                      metadata: { labels: { ...podLabels } },
                      spec: { restartPolicy: 'OnFailure', containers: [{ name: 'app', image: 'nginx:latest' }] },
                  },
              },
    };
}

/**
 * Helper to fetch a node's saved position from localStorage.
 * Used on initial load to preserve manual drag positions.
 */
function getSavedPosition(kind: string, name: string): { x: number; y: number } | null {
    try {
        const saved = localStorage.getItem('veltra_node_positions');
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

/**
 * Convert an array of parsed K8s resources into React Flow nodes with true nested containment.
 *
 * Kubernetes controller simulation:
 * - A Deployment with no matching ReplicaSet in the manifest gets a synthetic one
 *   (named `<name>-<hash>` like a real pod-template-hash RS).
 * - Every ReplicaSet (real or synthetic) materializes Pods up to `spec.replicas`,
 *   on top of any explicit Pods in the manifest that its selector claims.
 * - Synthetic resources are flagged `synthetic` + `managedBy` in node data; they are
 *   display-only and are never serialized back to YAML.
 *
 * Layout rules:
 * 1. Pods are nested inside ReplicaSets. Lay out in a 3-column grid. Compute ReplicaSet size.
 * 2. ReplicaSets are nested inside Deployments. Lay out horizontally in a row. Compute Deployment size.
 * 3. Services are placed in a lane above workloads (Y = 175). Auto-align horizontally above the Pods they select.
 * 4. Ingresses are placed in the top lane (Y = 25). Auto-align horizontally above the Services they target.
 * 5. HPAs and VPAs share an autoscaler lane below workloads (Y = 520) with a
 *    single collision pass so the two kinds never overlap. Auto-align
 *    horizontally above the resource they scale (VPA via spec.targetRef, which
 *    may also point at a Pod/Job/CronJob).
 * 6. ConfigMaps are placed in a lane below HPAs (Y = 680). They receive inferred
 *    "uses" edges from every workload whose Pod spec references them.
 * 7. PVCs are placed in a lane below ConfigMaps (Y = 840). They receive inferred
 *    "mounts" edges from every workload whose Pod spec claims them, plus a "binds"
 *    edge to the single PV (spec.volumeName) or StorageClass (spec.storageClassName)
 *    they reference — storage is explicit-only, no controller simulation.
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
 *    and Route→Service "routes to" (spec.backendRefs[].name) — explicit-only,
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
} {
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
    const hpas = resources.filter((r) => r.kind === 'HPA');
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

    // Ownership assignment: each ReplicaSet is claimed by at most ONE Deployment,
    // each Pod by at most ONE ReplicaSet (first match wins). This prevents a resource
    // from being rendered multiple times under different parents.
    const claimedRs = new Set<K8sResource>();
    const depToRs = new Map<K8sResource, K8sResource[]>();
    deployments.forEach((dep) => {
        const children = replicaSets.filter((rs) => {
            if (claimedRs.has(rs)) return false;
            return ownsResource(dep, rs);
        });
        children.forEach((rs) => claimedRs.add(rs));
        depToRs.set(dep, children);
    });

    // ── Controller simulation: materialize what Kubernetes would create ─────
    /** synthetic resource → its nearest REAL controlling resource */
    const syntheticOwner = new Map<K8sResource, { kind: SupportedKind; name: string }>();

    /**
     * The effective replica count of a workload under HPA priority:
     * clamp(spec.replicas, [minReplicas, maxReplicas]) of the first HPA that
     * targets it. The store has already written the clamped value back into
     * spec.replicas, so this mostly returns replicasOf() — the fallback keeps
     * materialization correct even when buildGraph runs pre-override.
     */
    const effectiveReplicasOf = (resource: K8sResource): number => {
        for (const hpa of hpas) {
            const effective = effectiveReplicas(hpa, resource);
            if (effective !== undefined) return effective;
        }
        return replicasOf(resource);
    };

    /** A ReplicaSet inside an HPA-scaled Deployment materializes to the Deployment's
     *  effective count (the Deployment controller drives its ReplicaSets' scale). */
    const desiredReplicasFor = (rs: K8sResource): number => {
        const ownerDep = deployments.find((dep) => depToRs.get(dep)?.includes(rs));
        if (ownerDep && hpas.some((hpa) => hpaTargets(hpa, ownerDep))) {
            return effectiveReplicasOf(ownerDep);
        }
        return effectiveReplicasOf(rs);
    };

    deployments.forEach((dep) => {
        const children = depToRs.get(dep)!;
        if (children.length === 0) {
            const rs = synthesizeReplicaSet(dep, effectiveReplicasOf(dep));
            syntheticOwner.set(rs, { kind: 'Deployment', name: dep.metadata.name });
            children.push(rs);
        }
    });
    const syntheticRs = [...syntheticOwner.keys()];

    // Real ReplicaSets claim explicit Pods first, then synthetic ones get a chance
    const allReplicaSets = [...replicaSets, ...syntheticRs];
    const claimedPods = new Set<K8sResource>();
    const rsToPod = new Map<K8sResource, K8sResource[]>();
    allReplicaSets.forEach((rs) => {
        const children = pods.filter((pod) => {
            if (claimedPods.has(pod)) return false;
            return ownsResource(rs, pod);
        });
        children.forEach((pod) => claimedPods.add(pod));
        rsToPod.set(rs, children);
    });

    // Materialize the pod shortfall for every ReplicaSet: replicas minus explicit pods
    const usedPodNames = new Set(pods.map((p) => p.metadata.name));
    const syntheticPods: K8sResource[] = [];
    allReplicaSets.forEach((rs) => {
        const explicit = rsToPod.get(rs) ?? [];
        const desired = desiredReplicasFor(rs);
        const shortfall = Math.min(Math.max(desired - explicit.length, 0), MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;

        const owner = syntheticOwner.get(rs) ?? { kind: rs.kind, name: rs.metadata.name };
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${rs.metadata.name}-${suffix++}`;
            while (usedPodNames.has(name)) name = `${rs.metadata.name}-${suffix++}`;
            usedPodNames.add(name);
            const pod = synthesizePod(rs, name);
            syntheticOwner.set(pod, owner);
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        rsToPod.set(rs, [...explicit, ...generated]);
    });

    // Jobs own their Pods directly (no ReplicaSet layer): claim explicit Pods that
    // match the Job's selector/name, then materialize the shortfall up to
    // spec.parallelism. Job Pods are siblings of the Job node (linked by an inferred
    // edge), never nested — Kubernetes never re-parents them.
    const jobToPod = new Map<K8sResource, K8sResource[]>();
    const claimedJobPods = new Set<K8sResource>();
    jobs.forEach((job) => {
        const children = pods.filter((pod) => {
            if (claimedJobPods.has(pod)) return false;
            return ownsResource(job, pod);
        });
        children.forEach((pod) => claimedJobPods.add(pod));
        jobToPod.set(job, children);
    });
    const usedJobPodNames = new Set(pods.map((p) => p.metadata.name));
    jobs.forEach((job) => {
        const explicit = jobToPod.get(job) ?? [];
        const desired = parallelismOf(job);
        const shortfall = Math.min(Math.max(desired - explicit.length, 0), MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${job.metadata.name}-${suffix++}`;
            while (usedJobPodNames.has(name)) name = `${job.metadata.name}-${suffix++}`;
            usedJobPodNames.add(name);
            const pod = synthesizePod(job, name);
            syntheticOwner.set(pod, { kind: 'Job', name: job.metadata.name });
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        jobToPod.set(job, [...explicit, ...generated]);
    });

    // CronJobs always create their OWN Job (never claim an existing one — a real
    // Job in the manifest stays standalone). Synthesize exactly one Job from the
    // CronJob's spec.jobTemplate.spec and materialize its Pods up to the
    // template's parallelism. The Job and its Pods are siblings of the CronJob
    // node (linked by inferred edges), never nested.
    const cronToJob = new Map<K8sResource, K8sResource>();
    const syntheticCronJobs: K8sResource[] = [];
    cronJobs.forEach((cron) => {
        const job = synthesizeJob(cron);
        syntheticOwner.set(job, { kind: 'CronJob', name: cron.metadata.name });
        cronToJob.set(cron, job);
        syntheticCronJobs.push(job);
    });
    syntheticCronJobs.forEach((job) => {
        const desired = parallelismOf(job);
        const shortfall = Math.min(desired, MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;
        const owner = syntheticOwner.get(job) ?? { kind: 'CronJob', name: job.metadata.name };
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${job.metadata.name}-${suffix++}`;
            while (usedJobPodNames.has(name)) name = `${job.metadata.name}-${suffix++}`;
            usedJobPodNames.add(name);
            const pod = synthesizePod(job, name);
            syntheticOwner.set(pod, owner);
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        jobToPod.set(job, generated);
    });

    /** All pods that end up on the canvas — explicit + controller-materialized. */
    const allPods = [...pods, ...syntheticPods];

    /** synthetic/managedBy node-data fragment for a resource (empty for real resources). */
    const syntheticMeta = (resource: K8sResource): Partial<K8sNodeData> => {
        const owner = syntheticOwner.get(resource);
        return owner ? { synthetic: true, managedBy: owner } : {};
    };

    // Standalone elements
    const standaloneRs = replicaSets.filter((rs) => !claimedRs.has(rs));
    const standalonePods = pods.filter((pod) => !claimedPods.has(pod) && !claimedJobPods.has(pod));

    // Keep track of all absolute coordinates for aligning Services/Ingresses
    const absCoords = new Map<string, { x: number; y: number }>();

    // Final nodes accumulator
    const nodes: Node<K8sNodeData>[] = [];

    // Node ID allocation — unique even for duplicate kind+name resources
    const usedIds = new Set<string>();
    const idByResource = new Map<K8sResource, string>();
    const allocateId = (resource: K8sResource) => {
        const base = nodeIdFor(resource.kind, resource.metadata.name);
        let id = base;
        let n = 2;
        while (usedIds.has(id)) id = `${base}#${n++}`;
        usedIds.add(id);
        idByResource.set(resource, id);
        return id;
    };

    // 1. LAY OUT WORKLOADS (Deployments, Standalone RS, Standalone Pods)
    let workloadXCursor = 50;

    const emitPod = (
        pod: K8sResource,
        parentId: string,
        parentAbs: { x: number; y: number },
        podIdx: number
    ) => {
        const podId = allocateId(pod);
        const colIdx = podIdx % 3;
        const rowIdx = Math.floor(podIdx / 3);

        const podRelPos = {
            x: RS_PADDING.left + colIdx * (POD_WIDTH + POD_GAP),
            y: RS_HEADER_HEIGHT + RS_PADDING.top + rowIdx * (POD_HEIGHT + POD_GAP),
        };
        absCoords.set(podId, { x: parentAbs.x + podRelPos.x, y: parentAbs.y + podRelPos.y });

        nodes.push({
            id: podId,
            parentId,
            extent: 'parent',
            type: 'k8sNode',
            position: podRelPos,
            style: { width: POD_WIDTH, height: POD_HEIGHT },
            data: {
                kind: 'Pod',
                name: pod.metadata.name,
                namespace: pod.metadata.namespace,
                resource: pod,
                ...syntheticMeta(pod),
            },
            draggable: false,
        });
    };

    const rsSize = (rs: K8sResource) => {
        const podCount = (rsToPod.get(rs) ?? []).length;
        let width = 180;
        let height = 90;
        if (podCount > 0) {
            const cols = Math.min(podCount, 3);
            const rows = Math.ceil(podCount / 3);
            width = RS_PADDING.left + RS_PADDING.right + cols * POD_WIDTH + (cols - 1) * POD_GAP;
            height = RS_HEADER_HEIGHT + RS_PADDING.top + RS_PADDING.bottom + rows * POD_HEIGHT + (rows - 1) * POD_GAP;
        }
        return { width, height };
    };

    const depWidthOf = (dep: K8sResource) => {
        const childRs = depToRs.get(dep) ?? [];
        if (!childRs.length) return 220;
        let w = DEP_PADDING.left;
        childRs.forEach((rs) => {
            w += rsSize(rs).width + RS_GAP;
        });
        return w - RS_GAP + DEP_PADDING.right;
    };

    // Workload auto-placement must clear user-positioned workloads, otherwise every
    // new node lands at the cursor origin and stacks on top of the pinned ones
    // (which also buries their connection handles).
    const fixedWorkloadSpans: Array<{ x: number; width: number }> = [];
    const workloadPos = (kind: string, name: string) =>
        prevCoords.get(`${kind}:${name}`) || getSavedPosition(kind, name);
    deployments.forEach((dep) => {
        const pos = workloadPos('Deployment', dep.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: depWidthOf(dep) });
    });
    standaloneRs.forEach((rs) => {
        const pos = workloadPos('ReplicaSet', rs.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: rsSize(rs).width });
    });
    standalonePods.forEach((pod) => {
        const pos = workloadPos('Pod', pod.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: POD_WIDTH });
    });
    jobs.forEach((job) => {
        const pos = workloadPos('Job', job.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: JOB_WIDTH });
    });
    cronJobs.forEach((cron) => {
        const pos = workloadPos('CronJob', cron.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: CRONJOB_WIDTH });
    });
    // A pinned synthetic CronJob Job is a top-level workload too — auto-placed
    // nodes must clear it just like a real Job's pinned position.
    syntheticCronJobs.forEach((job) => {
        const pos = workloadPos('Job', job.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: JOB_WIDTH });
    });

    const autoPlaceWorkload = (width: number): number => {
        let x = workloadXCursor;
        let moved = true;
        while (moved) {
            moved = false;
            for (const span of fixedWorkloadSpans) {
                if (x < span.x + span.width + WORKLOAD_GAP && x + width + WORKLOAD_GAP > span.x) {
                    x = span.x + span.width + WORKLOAD_GAP;
                    moved = true;
                }
            }
        }
        workloadXCursor = x + width + WORKLOAD_GAP;
        return x;
    };

    // A. Deployments
    deployments.forEach((dep) => {
        const childRs = depToRs.get(dep) ?? [];

        // First layout nested components to determine Deployment size
        const rsDimensions: Array<{ width: number; height: number; x: number; y: number; node: K8sResource }> = [];
        let currentRsX = DEP_PADDING.left;
        let maxRsHeight = 80;

        childRs.forEach((rs) => {
            const { width: rsWidth, height: rsHeight } = rsSize(rs);
            rsDimensions.push({
                width: rsWidth,
                height: rsHeight,
                x: currentRsX,
                y: DEP_HEADER_HEIGHT + DEP_PADDING.top,
                node: rs,
            });
            currentRsX += rsWidth + RS_GAP;
            if (rsHeight > maxRsHeight) maxRsHeight = rsHeight;
        });

        // Compute Deployment dimensions
        const depWidth = childRs.length > 0
            ? currentRsX - RS_GAP + DEP_PADDING.right
            : 220;
        const depHeight = childRs.length > 0
            ? DEP_HEADER_HEIGHT + DEP_PADDING.top + DEP_PADDING.bottom + maxRsHeight
            : 100;

        // Position Deployment
        const depId = allocateId(dep);
        const key = `Deployment:${dep.metadata.name}`;
        const savedPos = getSavedPosition('Deployment', dep.metadata.name);
        const prevPos = prevCoords.get(key);
        const depPos = prevPos || savedPos || { x: autoPlaceWorkload(depWidth), y: 320 };

        absCoords.set(depId, depPos);

        nodes.push({
            id: depId,
            type: 'k8sNode',
            position: depPos,
            style: { width: depWidth, height: depHeight },
            data: {
                kind: 'Deployment',
                name: dep.metadata.name,
                namespace: dep.metadata.namespace,
                resource: dep,
            },
            draggable: true,
        });

        // Add child ReplicaSets and Pods
        rsDimensions.forEach((rsDim) => {
            const rsId = allocateId(rsDim.node);
            const rsRelPos = { x: rsDim.x, y: rsDim.y };
            const rsAbsPos = { x: depPos.x + rsRelPos.x, y: depPos.y + rsRelPos.y };
            absCoords.set(rsId, rsAbsPos);

            nodes.push({
                id: rsId,
                parentId: depId,
                extent: 'parent',
                type: 'k8sNode',
                position: rsRelPos,
                style: { width: rsDim.width, height: rsDim.height },
                data: {
                    kind: 'ReplicaSet',
                    name: rsDim.node.metadata.name,
                    namespace: rsDim.node.metadata.namespace,
                    resource: rsDim.node,
                    ...syntheticMeta(rsDim.node),
                },
                draggable: false,
            });

            (rsToPod.get(rsDim.node) ?? []).forEach((pod, podIdx) => emitPod(pod, rsId, rsAbsPos, podIdx));
        });
    });

    // B. Standalone ReplicaSets
    standaloneRs.forEach((rs) => {
        const rsId = allocateId(rs);
        const { width: rsWidth, height: rsHeight } = rsSize(rs);

        const key = `ReplicaSet:${rs.metadata.name}`;
        const savedPos = getSavedPosition('ReplicaSet', rs.metadata.name);
        const prevPos = prevCoords.get(key);
        const rsPos = prevPos || savedPos || { x: autoPlaceWorkload(rsWidth), y: 320 };

        absCoords.set(rsId, rsPos);

        nodes.push({
            id: rsId,
            type: 'k8sNode',
            position: rsPos,
            style: { width: rsWidth, height: rsHeight },
            data: {
                kind: 'ReplicaSet',
                name: rs.metadata.name,
                namespace: rs.metadata.namespace,
                resource: rs,
            },
            draggable: true,
        });

        (rsToPod.get(rs) ?? []).forEach((pod, podIdx) => emitPod(pod, rsId, rsPos, podIdx));
    });

    // C. Standalone Pods
    standalonePods.forEach((pod) => {
        const podId = allocateId(pod);
        const key = `Pod:${pod.metadata.name}`;
        const savedPos = getSavedPosition('Pod', pod.metadata.name);
        const prevPos = prevCoords.get(key);
        const podPos = prevPos || savedPos || { x: autoPlaceWorkload(POD_WIDTH), y: 320 };

        absCoords.set(podId, podPos);

        nodes.push({
            id: podId,
            type: 'k8sNode',
            position: podPos,
            style: { width: POD_WIDTH, height: POD_HEIGHT },
            data: {
                kind: 'Pod',
                name: pod.metadata.name,
                namespace: pod.metadata.namespace,
                resource: pod,
            },
            draggable: true,
        });
    });

    // D. Jobs — the Job node plus the Pods it runs (siblings, linked by an inferred edge)
    jobs.forEach((job) => {
        const jobId = allocateId(job);
        const key = `Job:${job.metadata.name}`;
        const savedPos = getSavedPosition('Job', job.metadata.name);
        const prevPos = prevCoords.get(key);
        const jobPos = prevPos || savedPos || { x: autoPlaceWorkload(JOB_WIDTH), y: 320 };

        absCoords.set(jobId, jobPos);

        nodes.push({
            id: jobId,
            type: 'k8sNode',
            position: jobPos,
            style: { width: JOB_WIDTH, height: JOB_HEIGHT },
            data: {
                kind: 'Job',
                name: job.metadata.name,
                namespace: job.metadata.namespace,
                resource: job,
            },
            draggable: true,
        });

        const children = jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = allocateId(pod);
            const savedPodPos = getSavedPosition('Pod', pod.metadata.name);
            const prevPodPos = prevCoords.get(`Pod:${pod.metadata.name}`);
            const podPos = prevPodPos || savedPodPos || {
                x: autoPlaceWorkload(POD_WIDTH),
                y: 320,
            };
            absCoords.set(podId, podPos);
            nodes.push({
                id: podId,
                type: 'k8sNode',
                position: podPos,
                style: { width: POD_WIDTH, height: POD_HEIGHT },
                data: {
                    kind: 'Pod',
                    name: pod.metadata.name,
                    namespace: pod.metadata.namespace,
                    resource: pod,
                    ...syntheticMeta(pod),
                },
                draggable: true,
            });
        });
    });

    // E. CronJobs — the CronJob node plus the Job it creates and that Job's Pods
    // (all siblings, linked by inferred edges). The synthetic Job and its Pods
    // are draggable like a real Job's Pods (positions persist), and are
    // auto-placed right after their CronJob so the group reads left-to-right:
    // CronJob → Job → Pods.
    cronJobs.forEach((cron) => {
        const cronId = allocateId(cron);
        const key = `CronJob:${cron.metadata.name}`;
        const savedPos = getSavedPosition('CronJob', cron.metadata.name);
        const prevPos = prevCoords.get(key);
        const cronPos = prevPos || savedPos || { x: autoPlaceWorkload(CRONJOB_WIDTH), y: 320 };

        absCoords.set(cronId, cronPos);

        nodes.push({
            id: cronId,
            type: 'k8sNode',
            position: cronPos,
            style: { width: CRONJOB_WIDTH, height: CRONJOB_HEIGHT },
            data: {
                kind: 'CronJob',
                name: cron.metadata.name,
                namespace: cron.metadata.namespace,
                resource: cron,
            },
            draggable: true,
        });

        const job = cronToJob.get(cron);
        if (!job) return;
        const jobId = allocateId(job);
        const savedJobPos = getSavedPosition('Job', job.metadata.name);
        const prevJobPos = prevCoords.get(`Job:${job.metadata.name}`);
        const jobPos = prevJobPos || savedJobPos || { x: autoPlaceWorkload(JOB_WIDTH), y: 320 };
        absCoords.set(jobId, jobPos);
        nodes.push({
            id: jobId,
            type: 'k8sNode',
            position: jobPos,
            style: { width: JOB_WIDTH, height: JOB_HEIGHT },
            data: {
                kind: 'Job',
                name: job.metadata.name,
                namespace: job.metadata.namespace,
                resource: job,
                ...syntheticMeta(job),
            },
            draggable: true,
        });

        const children = jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = allocateId(pod);
            const savedPodPos = getSavedPosition('Pod', pod.metadata.name);
            const prevPodPos = prevCoords.get(`Pod:${pod.metadata.name}`);
            const podPos = prevPodPos || savedPodPos || {
                x: autoPlaceWorkload(POD_WIDTH),
                y: 320,
            };
            absCoords.set(podId, podPos);
            nodes.push({
                id: podId,
                type: 'k8sNode',
                position: podPos,
                style: { width: POD_WIDTH, height: POD_HEIGHT },
                data: {
                    kind: 'Pod',
                    name: pod.metadata.name,
                    namespace: pod.metadata.namespace,
                    resource: pod,
                    ...syntheticMeta(pod),
                },
                draggable: true,
            });
        });
    });

    // 2. LAY OUT SERVICES
    const serviceLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let serviceXCursor = 50;

    services.forEach((svc) => {
        const svcId = allocateId(svc);
        const key = `Service:${svc.metadata.name}`;
        const savedPos = getSavedPosition('Service', svc.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Find selected Pods to center the Service above them
            const selector = getSelector(svc);
            const matchingIds: string[] = [];

            if (selector) {
                allPods.forEach((pod) => {
                    if (matchesSelector(selector, getTargetLabels(pod))) {
                        const id = idByResource.get(pod);
                        if (id) matchingIds.push(id);
                    }
                });
            }

            if (matchingIds.length > 0) {
                const sumX = matchingIds.reduce((acc, pId) => acc + (absCoords.get(pId)?.x || 0), 0);
                preferredX = sumX / matchingIds.length;
            } else {
                preferredX = serviceXCursor;
                serviceXCursor += 200;
            }
        }

        serviceLayoutInfo.push({
            id: svcId,
            x: preferredX,
            width: 170,
            node: svc,
        });
    });

    // Resolve Service overlaps (only for non-user-dragged nodes)
    const draggedServiceIds = new Set(
        serviceLayoutInfo
            .filter(({ node }) => prevCoords.has(`Service:${node.metadata.name}`) || getSavedPosition('Service', node.metadata.name))
            .map(({ id }) => id)
    );

    resolveCollisions(serviceLayoutInfo, draggedServiceIds, 24);

    serviceLayoutInfo.forEach((sInfo) => {
        const key = `Service:${sInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('Service', sInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 175;

        const pos = { x: sInfo.x, y: yCoord };
        absCoords.set(sInfo.id, pos);

        nodes.push({
            id: sInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: 170, height: SERVICE_HEIGHT },
            data: {
                kind: 'Service',
                name: sInfo.node.metadata.name,
                namespace: sInfo.node.metadata.namespace,
                resource: sInfo.node,
            },
            draggable: true,
        });
    });

    // Name → node ID lookup for services (first occurrence wins for duplicates)
    const serviceIdByName = new Map<string, string>();
    services.forEach((svc) => {
        const id = idByResource.get(svc);
        if (id && !serviceIdByName.has(svc.metadata.name)) {
            serviceIdByName.set(svc.metadata.name, id);
        }
    });

    // 3. LAY OUT INGRESSES
    const ingressLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let ingressXCursor = 50;

    ingresses.forEach((ing) => {
        const ingId = allocateId(ing);
        const key = `Ingress:${ing.metadata.name}`;
        const savedPos = getSavedPosition('Ingress', ing.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Find targeted services
            const targetIds = getIngressServiceNames(ing)
                .map((name) => serviceIdByName.get(name))
                .filter((id): id is string => !!id && absCoords.has(id));

            if (targetIds.length > 0) {
                const sumX = targetIds.reduce((acc, tId) => acc + (absCoords.get(tId)?.x || 0), 0);
                preferredX = sumX / targetIds.length;
            } else {
                preferredX = ingressXCursor;
                ingressXCursor += 210;
            }
        }

        ingressLayoutInfo.push({
            id: ingId,
            x: preferredX,
            width: 180,
            node: ing,
        });
    });

    const draggedIngressIds = new Set(
        ingressLayoutInfo
            .filter(({ node }) => prevCoords.has(`Ingress:${node.metadata.name}`) || getSavedPosition('Ingress', node.metadata.name))
            .map(({ id }) => id)
    );

    resolveCollisions(ingressLayoutInfo, draggedIngressIds, 24);

    ingressLayoutInfo.forEach((iInfo) => {
        const key = `Ingress:${iInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('Ingress', iInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 25;

        const pos = { x: iInfo.x, y: yCoord };
        absCoords.set(iInfo.id, pos);

        nodes.push({
            id: iInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: 180, height: INGRESS_HEIGHT },
            data: {
                kind: 'Ingress',
                name: iInfo.node.metadata.name,
                namespace: iInfo.node.metadata.namespace,
                resource: iInfo.node,
            },
            draggable: true,
        });
    });

    // 4. LAY OUT AUTOSCALERS (HPAs + VPAs) — shared lane at Y = 520, resolved
    //    in ONE collision pass so the two kinds never overlap in X.
    const hpaLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let hpaXCursor = 50;

    hpas.forEach((hpa) => {
        const hpaId = allocateId(hpa);
        const key = `HPA:${hpa.metadata.name}`;
        const savedPos = getSavedPosition('HPA', hpa.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Center above the workload it scales when possible
            const target = getHpaTarget(hpa);
            const targetId = target
                ? nodes.find((n) => n.data.kind === target.kind && n.data.name === target.name)?.id
                : undefined;
            if (targetId && absCoords.has(targetId)) {
                preferredX = absCoords.get(targetId)!.x;
            } else {
                preferredX = hpaXCursor;
                hpaXCursor += 200;
            }
        }

        hpaLayoutInfo.push({
            id: hpaId,
            x: preferredX,
            width: HPA_WIDTH,
            node: hpa,
        });
    });

    const vpaLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let vpaXCursor = 50;

    vpas.forEach((vpa) => {
        const vpaId = allocateId(vpa);
        const key = `VerticalPodAutoscaler:${vpa.metadata.name}`;
        const savedPos = getSavedPosition('VerticalPodAutoscaler', vpa.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Center above the workload/Pod it right-sizes when possible
            const target = getVpaTarget(vpa);
            const targetId = target
                ? nodes.find((n) => n.data.kind === target.kind && n.data.name === target.name)?.id
                : undefined;
            if (targetId && absCoords.has(targetId)) {
                preferredX = absCoords.get(targetId)!.x;
            } else {
                preferredX = vpaXCursor;
                vpaXCursor += 210;
            }
        }

        vpaLayoutInfo.push({
            id: vpaId,
            x: preferredX,
            width: VPA_WIDTH,
            node: vpa,
        });
    });

    const autoscalerLayoutInfo = [...hpaLayoutInfo, ...vpaLayoutInfo];
    const draggedAutoscalerIds = new Set(
        autoscalerLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`${node.kind}:${node.metadata.name}`) ||
                    getSavedPosition(node.kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(autoscalerLayoutInfo, draggedAutoscalerIds, 24);

    autoscalerLayoutInfo.forEach((aInfo) => {
        const key = `${aInfo.node.kind}:${aInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition(aInfo.node.kind, aInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 520;

        const pos = { x: aInfo.x, y: yCoord };
        absCoords.set(aInfo.id, pos);

        nodes.push({
            id: aInfo.id,
            type: 'k8sNode',
            position: pos,
            style: {
                width: aInfo.node.kind === 'HPA' ? HPA_WIDTH : VPA_WIDTH,
                height: aInfo.node.kind === 'HPA' ? HPA_HEIGHT : VPA_HEIGHT,
            },
            data: {
                kind: aInfo.node.kind,
                name: aInfo.node.metadata.name,
                namespace: aInfo.node.metadata.namespace,
                resource: aInfo.node,
            },
            draggable: true,
        });
    });

    // 5. LAY OUT CONFIGMAPS
    const configmapLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let configmapXCursor = 50;

    configmaps.forEach((cm) => {
        const cmId = allocateId(cm);
        const key = `ConfigMap:${cm.metadata.name}`;
        const savedPos = getSavedPosition('ConfigMap', cm.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = configmapXCursor;
            configmapXCursor += 210;
        }

        configmapLayoutInfo.push({
            id: cmId,
            x: preferredX,
            width: CONFIGMAP_WIDTH,
            node: cm,
        });
    });

    const draggedConfigmapIds = new Set(
        configmapLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`ConfigMap:${node.metadata.name}`) ||
                    getSavedPosition('ConfigMap', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(configmapLayoutInfo, draggedConfigmapIds, 24);

    configmapLayoutInfo.forEach((cmInfo) => {
        const key = `ConfigMap:${cmInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('ConfigMap', cmInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 680;

        const pos = { x: cmInfo.x, y: yCoord };
        absCoords.set(cmInfo.id, pos);

        nodes.push({
            id: cmInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: CONFIGMAP_WIDTH, height: CONFIGMAP_HEIGHT },
            data: {
                kind: 'ConfigMap',
                name: cmInfo.node.metadata.name,
                namespace: cmInfo.node.metadata.namespace,
                resource: cmInfo.node,
            },
            draggable: true,
        });
    });

    // 6. LAY OUT PVCs (PersistentVolumeClaims) — claim lane below ConfigMaps.
    //    PVCs are claimed by Pods (spec.volumes[].persistentVolumeClaim) and bind
    //    to exactly one PV (spec.volumeName) or StorageClass (spec.storageClassName).
    const pvcLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let pvcXCursor = 50;

    pvcs.forEach((pvc) => {
        const pvcId = allocateId(pvc);
        const key = `PersistentVolumeClaim:${pvc.metadata.name}`;
        const savedPos = getSavedPosition('PersistentVolumeClaim', pvc.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = pvcXCursor;
            pvcXCursor += 205;
        }

        pvcLayoutInfo.push({
            id: pvcId,
            x: preferredX,
            width: PVC_WIDTH,
            node: pvc,
        });
    });

    const draggedPvcIds = new Set(
        pvcLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`PersistentVolumeClaim:${node.metadata.name}`) ||
                    getSavedPosition('PersistentVolumeClaim', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(pvcLayoutInfo, draggedPvcIds, 24);

    pvcLayoutInfo.forEach((pvcInfo) => {
        const key = `PersistentVolumeClaim:${pvcInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('PersistentVolumeClaim', pvcInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 840;

        const pos = { x: pvcInfo.x, y: yCoord };
        absCoords.set(pvcInfo.id, pos);

        nodes.push({
            id: pvcInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: PVC_WIDTH, height: PVC_HEIGHT },
            data: {
                kind: 'PersistentVolumeClaim',
                name: pvcInfo.node.metadata.name,
                namespace: pvcInfo.node.metadata.namespace,
                resource: pvcInfo.node,
            },
            draggable: true,
        });
    });

    // 7. LAY OUT PVs (PersistentVolumes) — bind lane below PVCs.
    const pvLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let pvXCursor = 50;

    pvs.forEach((pv) => {
        const pvId = allocateId(pv);
        const key = `PersistentVolume:${pv.metadata.name}`;
        const savedPos = getSavedPosition('PersistentVolume', pv.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = pvXCursor;
            pvXCursor += 205;
        }

        pvLayoutInfo.push({
            id: pvId,
            x: preferredX,
            width: PV_WIDTH,
            node: pv,
        });
    });

    const draggedPvIds = new Set(
        pvLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`PersistentVolume:${node.metadata.name}`) ||
                    getSavedPosition('PersistentVolume', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(pvLayoutInfo, draggedPvIds, 24);

    pvLayoutInfo.forEach((pvInfo) => {
        const key = `PersistentVolume:${pvInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('PersistentVolume', pvInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1000;

        const pos = { x: pvInfo.x, y: yCoord };
        absCoords.set(pvInfo.id, pos);

        nodes.push({
            id: pvInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: PV_WIDTH, height: PV_HEIGHT },
            data: {
                kind: 'PersistentVolume',
                name: pvInfo.node.metadata.name,
                namespace: pvInfo.node.metadata.namespace,
                resource: pvInfo.node,
            },
            draggable: true,
        });
    });

    // 8. LAY OUT STORAGECLASSES — provisioning lane below PVs.
    const storageClassLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let storageClassXCursor = 50;

    storageClasses.forEach((sc) => {
        const scId = allocateId(sc);
        const key = `StorageClass:${sc.metadata.name}`;
        const savedPos = getSavedPosition('StorageClass', sc.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = storageClassXCursor;
            storageClassXCursor += 215;
        }

        storageClassLayoutInfo.push({
            id: scId,
            x: preferredX,
            width: STORAGECLASS_WIDTH,
            node: sc,
        });
    });

    const draggedStorageClassIds = new Set(
        storageClassLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`StorageClass:${node.metadata.name}`) ||
                    getSavedPosition('StorageClass', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(storageClassLayoutInfo, draggedStorageClassIds, 24);

    storageClassLayoutInfo.forEach((scInfo) => {
        const key = `StorageClass:${scInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('StorageClass', scInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1160;

        const pos = { x: scInfo.x, y: yCoord };
        absCoords.set(scInfo.id, pos);

        nodes.push({
            id: scInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: STORAGECLASS_WIDTH, height: STORAGECLASS_HEIGHT },
            data: {
                kind: 'StorageClass',
                name: scInfo.node.metadata.name,
                namespace: scInfo.node.metadata.namespace,
                resource: scInfo.node,
            },
            draggable: true,
        });
    });

    // 9. LAY OUT SECRETS — secret lane below StorageClasses.
    const secretLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let secretXCursor = 50;

    secrets.forEach((secret) => {
        const secretId = allocateId(secret);
        const key = `Secret:${secret.metadata.name}`;
        const savedPos = getSavedPosition('Secret', secret.metadata.name);
        const prevPos = prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = secretXCursor;
            secretXCursor += 210;
        }

        secretLayoutInfo.push({
            id: secretId,
            x: preferredX,
            width: SECRET_WIDTH,
            node: secret,
        });
    });

    const draggedSecretIds = new Set(
        secretLayoutInfo
            .filter(
                ({ node }) =>
                    prevCoords.has(`Secret:${node.metadata.name}`) ||
                    getSavedPosition('Secret', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(secretLayoutInfo, draggedSecretIds, 24);

    secretLayoutInfo.forEach((secretInfo) => {
        const key = `Secret:${secretInfo.node.metadata.name}`;
        const prevPos = prevCoords.get(key);
        const savedPos = getSavedPosition('Secret', secretInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1320;

        const pos = { x: secretInfo.x, y: yCoord };
        absCoords.set(secretInfo.id, pos);

        nodes.push({
            id: secretInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: SECRET_WIDTH, height: SECRET_HEIGHT },
            data: {
                kind: 'Secret',
                name: secretInfo.node.metadata.name,
                namespace: secretInfo.node.metadata.namespace,
                resource: secretInfo.node,
            },
            draggable: true,
        });
    });

    // 10. LAY OUT GATEWAY API — GatewayClass (cluster-scoped, outside any namespace
    //     box) and Gateway (namespaced) share the gateway lane (Y = 1480) with a
    //     single combined collision pass so the two kinds never overlap.
    const gatewayLaneInfo: Array<{
        id: string;
        x: number;
        width: number;
        kind: 'GatewayClass' | 'Gateway';
        node: K8sResource;
    }> = [];
    let gatewayClassXCursor = 50;
    let gatewayXCursor = 50;

    gatewayClasses.forEach((gc) => {
        const gcId = allocateId(gc);
        const prevPos = prevCoords.get(`GatewayClass:${gc.metadata.name}`);
        const savedPos = getSavedPosition('GatewayClass', gc.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = gatewayClassXCursor;
            gatewayClassXCursor += GATEWAYCLASS_WIDTH + 24;
        }
        gatewayLaneInfo.push({
            id: gcId,
            x: preferredX,
            width: GATEWAYCLASS_WIDTH,
            kind: 'GatewayClass',
            node: gc,
        });
    });

    gateways.forEach((gw) => {
        const gwId = allocateId(gw);
        const prevPos = prevCoords.get(`Gateway:${gw.metadata.name}`);
        const savedPos = getSavedPosition('Gateway', gw.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = gatewayXCursor;
            gatewayXCursor += GATEWAY_WIDTH + 24;
        }
        gatewayLaneInfo.push({
            id: gwId,
            x: preferredX,
            width: GATEWAY_WIDTH,
            kind: 'Gateway',
            node: gw,
        });
    });

    const draggedGatewayLaneIds = new Set(
        gatewayLaneInfo
            .filter(
                ({ kind, node }) =>
                    prevCoords.has(`${kind}:${node.metadata.name}`) ||
                    getSavedPosition(kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(gatewayLaneInfo, draggedGatewayLaneIds, 24);

    gatewayLaneInfo.forEach((info) => {
        const prevPos = prevCoords.get(`${info.kind}:${info.node.metadata.name}`);
        const savedPos = getSavedPosition(info.kind, info.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1480;
        const width = info.kind === 'GatewayClass' ? GATEWAYCLASS_WIDTH : GATEWAY_WIDTH;
        const height = info.kind === 'GatewayClass' ? GATEWAYCLASS_HEIGHT : GATEWAY_HEIGHT;
        const pos = { x: info.x, y: yCoord };
        absCoords.set(info.id, pos);

        nodes.push({
            id: info.id,
            type: 'k8sNode',
            position: pos,
            style: { width, height },
            data: {
                kind: info.kind,
                name: info.node.metadata.name,
                namespace: info.node.metadata.namespace,
                resource: info.node,
            },
            draggable: true,
        });
    });

    // 11. LAY OUT ROUTES — every Gateway API route kind (HTTPRoute/GRPCRoute/TCPRoute/
    //     TLSRoute) shares the route lane (Y = 1640) with a single combined collision
    //     pass so the four kinds never overlap.
    const routeLaneInfo: Array<{ id: string; x: number; width: number; kind: SupportedKind; node: K8sResource }> = [];
    let routeXCursor = 50;

    routes.forEach((route) => {
        const routeId = allocateId(route);
        const prevPos = prevCoords.get(`${route.kind}:${route.metadata.name}`);
        const savedPos = getSavedPosition(route.kind, route.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = routeXCursor;
            routeXCursor += ROUTE_WIDTH + 24;
        }
        routeLaneInfo.push({
            id: routeId,
            x: preferredX,
            width: ROUTE_WIDTH,
            kind: route.kind,
            node: route,
        });
    });

    const draggedRouteLaneIds = new Set(
        routeLaneInfo
            .filter(
                ({ kind, node }) =>
                    prevCoords.has(`${kind}:${node.metadata.name}`) ||
                    getSavedPosition(kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(routeLaneInfo, draggedRouteLaneIds, 24);

    routeLaneInfo.forEach((info) => {
        const prevPos = prevCoords.get(`${info.kind}:${info.node.metadata.name}`);
        const savedPos = getSavedPosition(info.kind, info.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1640;
        const pos = { x: info.x, y: yCoord };
        absCoords.set(info.id, pos);

        nodes.push({
            id: info.id,
            type: 'k8sNode',
            position: pos,
            style: { width: ROUTE_WIDTH, height: ROUTE_HEIGHT },
            data: {
                kind: info.kind,
                name: info.node.metadata.name,
                namespace: info.node.metadata.namespace,
                resource: info.node,
            },
            draggable: true,
        });
    });

    // 12. GENERATE EDGES (Traffic Flow)
    const edges: Edge[] = [];
    const byId = new Map<string, Node<K8sNodeData>>();
    nodes.forEach((n) => byId.set(n.id, n));

    const edgeSet = new Set<string>();

    const addEdge = (sourceId: string, targetId: string, label: string) => {
        const source = byId.get(sourceId);
        const target = byId.get(targetId);
        if (!source || !target) return;

        const id = `${sourceId}->${targetId}:${label}`;
        if (edgeSet.has(id)) return;
        edgeSet.add(id);

        edges.push({
            id,
            source: sourceId,
            target: targetId,
            label,
            animated: true,
            // Inferred from YAML — pure visualization. Not deletable/selectable (edit the
            // relationship via inspector/YAML) and no fat hit-area: edges into nested pods
            // are z-elevated by React Flow and would otherwise swallow clicks on nodes
            // and handles they cross.
            deletable: false,
            selectable: false,
            interactionWidth: 0,
            style: {
                stroke: edgeColorForPair(source.data.kind, target.data.kind),
                strokeWidth: 2.2,
                filter: 'drop-shadow(0 0 4px rgba(96, 165, 250, 0.4))'
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 14,
                height: 14,
                color: edgeColorForPair(source.data.kind, target.data.kind),
            }
        });
    };

    // Ingress → Service
    ingresses.forEach((ing) => {
        const ingId = idByResource.get(ing);
        if (!ingId) return;
        getIngressServiceNames(ing).forEach((svcName) => {
            const svcId = serviceIdByName.get(svcName);
            if (svcId) addEdge(ingId, svcId, 'routes to');
        });
    });

    // CronJob → Job "triggers": every CronJob draws an edge to the Job it would
    // create for its next scheduled run (always the CronJob's own synthetic Job —
    // it never claims an existing one).
    cronJobs.forEach((cron) => {
        const cronId = idByResource.get(cron);
        if (!cronId) return;
        const job = cronToJob.get(cron);
        if (!job) return;
        const jobId = idByResource.get(job);
        if (jobId) addEdge(cronId, jobId, 'triggers');
    });

    // Job → Pod: every Pod a Job runs (claimed or materialized — including the
    // Jobs a CronJob synthesizes) is linked to its Job by an inferred edge — the
    // Job is the only owner these Pods have.
    [...jobs, ...syntheticCronJobs].forEach((job) => {
        const jobId = idByResource.get(job);
        if (!jobId) return;
        const children = jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = idByResource.get(pod);
            if (podId) addEdge(jobId, podId, 'owns');
        });
    });

    // Service → Pod (real Kubernetes networking: Services select Pods by labels,
    // including the controller-materialized ones). Falls back to a Service → workload
    // edge only when the workload matches but currently runs no pods (replicas: 0).
    services.forEach((svc) => {
        const svcId = idByResource.get(svc);
        const selector = getSelector(svc);
        if (!svcId || !selector) return;

        const svcSpec = svc.spec as { ports?: Array<{ port?: number }> } | undefined;
        const port = svcSpec?.ports?.[0]?.port;
        const edgeLabel = port ? `port: ${port}` : 'selects';

        const matchedPods = new Set<K8sResource>();
        allPods.forEach((pod) => {
            if (matchesSelector(selector, getTargetLabels(pod))) {
                matchedPods.add(pod);
                const podId = idByResource.get(pod);
                if (podId) addEdge(svcId, podId, edgeLabel);
            }
        });

        const workloadHasMatchedPod = (workload: K8sResource): boolean => {
            const contained = workload.kind === 'Deployment'
                ? (depToRs.get(workload) ?? []).flatMap((rs) => rsToPod.get(rs) ?? [])
                : (rsToPod.get(workload) ?? []);
            return contained.some((pod) => matchedPods.has(pod));
        };

        [...deployments, ...replicaSets].forEach((workload) => {
            if (!matchesSelector(selector, getWorkloadPodLabels(workload))) return;
            if (workloadHasMatchedPod(workload)) return; // already connected to its pods
            // Skip nested ReplicaSets — connect to their owning Deployment instead
            if (workload.kind === 'ReplicaSet' && claimedRs.has(workload)) return;
            const wId = idByResource.get(workload);
            if (wId) addEdge(svcId, wId, edgeLabel);
        });
    });

    // HPA → scale target (Deployment/ReplicaSet)
    const workloadIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'Deployment' || n.data.kind === 'ReplicaSet') {
            const key = `${n.data.kind}:${n.data.name}`;
            if (!workloadIdByName.has(key)) workloadIdByName.set(key, n.id);
        }
    });

    hpas.forEach((hpa) => {
        const hpaId = idByResource.get(hpa);
        if (!hpaId) return;
        const target = getHpaTarget(hpa);
        if (!target) return;
        const targetId = workloadIdByName.get(`${target.kind}:${target.name}`);
        if (targetId) addEdge(hpaId, targetId, 'scales');
    });

    // VerticalPodAutoscaler → targetRef (Deployment/ReplicaSet/Pod/Job/CronJob):
    // a VPA right-sizes the Pods of the resource it points at, so the edge goes
    // to the targetRef node itself — never to the Pods nested inside it.
    const vpaTargetIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (
            n.data.kind === 'Deployment' ||
            n.data.kind === 'ReplicaSet' ||
            n.data.kind === 'Pod' ||
            n.data.kind === 'Job' ||
            n.data.kind === 'CronJob'
        ) {
            const key = `${n.data.kind}:${n.data.name}`;
            if (!vpaTargetIdByName.has(key)) vpaTargetIdByName.set(key, n.id);
        }
    });

    vpas.forEach((vpa) => {
        const vpaId = idByResource.get(vpa);
        if (!vpaId) return;
        const target = getVpaTarget(vpa);
        if (!target) return;
        const targetId = vpaTargetIdByName.get(`${target.kind}:${target.name}`);
        if (targetId) addEdge(vpaId, targetId, 'right-sizes');
    });

    // ConfigMap → "uses": every workload (real Deployment/ReplicaSet/Pod) whose Pod
    // spec references a ConfigMap draws an edge to it. Synthetic RSs/Pods are not
    // part of `resources`, so no double edges for inherited refs.
    const configmapIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'ConfigMap' && !configmapIdByName.has(n.data.name)) {
            configmapIdByName.set(n.data.name, n.id);
        }
    });

    resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const workloadId = idByResource.get(workload);
        if (!workloadId) return;
        getConfigMapRefs(workload).forEach((cmName) => {
            const cmId = configmapIdByName.get(cmName);
            if (cmId) addEdge(workloadId, cmId, 'uses');
        });
    });

    // Secret → "uses": every workload (real Deployment/ReplicaSet/Pod) whose Pod
    // spec references a Secret (envFrom[].secretRef, env[].valueFrom.secretKeyRef
    // or volumes[].secret) draws an edge to it.
    const secretIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'Secret' && !secretIdByName.has(n.data.name)) {
            secretIdByName.set(n.data.name, n.id);
        }
    });

    resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const workloadId = idByResource.get(workload);
        if (!workloadId) return;
        getSecretRefs(workload).forEach((secretName) => {
            const secretId = secretIdByName.get(secretName);
            if (secretId) addEdge(workloadId, secretId, 'uses');
        });
    });

    // Ingress → Secret "tls": every Ingress whose spec.tls[].secretName points at
    // a Secret on the canvas draws a TLS termination edge to it.
    ingresses.forEach((ing) => {
        const ingId = idByResource.get(ing);
        if (!ingId) return;
        getIngressTlsSecretNames(ing).forEach((secretName) => {
            const secretId = secretIdByName.get(secretName);
            if (secretId) addEdge(ingId, secretId, 'tls');
        });
    });

    // PersistentVolumeClaim → "mounts": every workload (real Deployment/ReplicaSet/Pod)
    // whose Pod spec declares spec.volumes[].persistentVolumeClaim draws an edge to the
    // claim. A PVC binds to exactly one target — a PV via spec.volumeName, or a
    // StorageClass via spec.storageClassName ("binds" edge). Missing targets draw
    // nothing (no controller simulation).
    const pvcIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'PersistentVolumeClaim' && !pvcIdByName.has(n.data.name)) {
            pvcIdByName.set(n.data.name, n.id);
        }
    });

    resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const workloadId = idByResource.get(workload);
        if (!workloadId) return;
        getPvcRefs(workload).forEach((claimName) => {
            const pvcId = pvcIdByName.get(claimName);
            if (pvcId) addEdge(workloadId, pvcId, 'mounts');
        });
    });

    const pvIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'PersistentVolume' && !pvIdByName.has(n.data.name)) {
            pvIdByName.set(n.data.name, n.id);
        }
    });
    const storageClassIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'StorageClass' && !storageClassIdByName.has(n.data.name)) {
            storageClassIdByName.set(n.data.name, n.id);
        }
    });

    pvcs.forEach((pvc) => {
        const pvcId = idByResource.get(pvc);
        if (!pvcId) return;
        const pvName = getPvForPvc(pvc);
        if (pvName) {
            const pvId = pvIdByName.get(pvName);
            if (pvId) addEdge(pvcId, pvId, 'binds');
        }
        const scName = getStorageClassForPvc(pvc);
        if (scName && !pvName) {
            const scId = storageClassIdByName.get(scName);
            if (scId) addEdge(pvcId, scId, 'binds');
        }
    });

    // Gateway API: Gateway → GatewayClass "class" (spec.gatewayClassName, 1:1),
    // Route → Gateway "attaches" (spec.parentRefs[].name) and Route → Service
    // "routes to" (spec.backendRefs[].name). Explicit-only like storage/ConfigMap:
    // a missing target draws nothing.
    const gatewayClassIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'GatewayClass' && !gatewayClassIdByName.has(n.data.name)) {
            gatewayClassIdByName.set(n.data.name, n.id);
        }
    });
    const gatewayIdByName = new Map<string, string>();
    nodes.forEach((n) => {
        if (n.data.kind === 'Gateway' && !gatewayIdByName.has(n.data.name)) {
            gatewayIdByName.set(n.data.name, n.id);
        }
    });

    gateways.forEach((gw) => {
        const gwId = idByResource.get(gw);
        if (!gwId) return;
        const className = getGatewayClassName(gw);
        if (!className) return;
        const classId = gatewayClassIdByName.get(className);
        if (classId) addEdge(gwId, classId, 'class');
    });

    routes.forEach((route) => {
        const routeId = idByResource.get(route);
        if (!routeId) return;
        getRouteParentRefNames(route).forEach((parentName) => {
            const parentId = gatewayIdByName.get(parentName);
            if (parentId) addEdge(routeId, parentId, 'attaches');
        });
        getRouteBackendRefNames(route).forEach((svcName) => {
            const svcId = serviceIdByName.get(svcName);
            if (svcId) addEdge(routeId, svcId, 'routes to');
        });
    });

    return { nodes, edges };
}

/** Inferred edge stroke color by source kind: HPA scaling (amber), Ingress routes (purple), Jobs (yellow), CronJobs (fuchsia), everything else (blue). */
function edgeColorFor(kind: string): string {
    if (kind === 'HPA') return '#f59e0b';
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
function edgeColorForPair(sourceKind: string, targetKind: string): string {
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
function resolveCollisions(
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

/** True when `parent` should own `child` (K8s controller semantics, approximated). */
function ownsResource(parent: K8sResource, child: K8sResource): boolean {
    const nameMatch = startsWithResourceName(child.metadata.name, parent.metadata.name);
    const selector = getSelector(parent);
    const labels = getTargetLabels(child);
    const selectorMatch = !!(selector && labels && matchesSelector(selector, labels));
    // Fallback: match by shared metadata.labels when no explicit selector is set
    const labelFallback = !selector && sharesLabel(parent.metadata?.labels, child.metadata?.labels);
    return nameMatch || selectorMatch || labelFallback;
}

function startsWithResourceName(name: string, parentName: string): boolean {
    return name === parentName || name.startsWith(`${parentName}-`);
}

function sharesLabel(
    aLabels: Record<string, string> | undefined,
    bLabels: Record<string, string> | undefined
): boolean {
    if (!aLabels || !bLabels) return false;
    return Object.entries(aLabels).some(([k, v]) => bLabels[k] === v);
}

export function getSelector(resource: K8sResource): Record<string, string> | undefined {
    const spec = resource.spec as { selector?: Record<string, string> } | undefined;
    // Handle standard spec.selector.matchLabels OR legacy selector
    if (spec?.selector && 'matchLabels' in spec.selector) {
        return (spec.selector as { matchLabels?: Record<string, string> }).matchLabels;
    }
    return spec?.selector;
}

export function getTargetLabels(resource: K8sResource): Record<string, string> | undefined {
    const metadataLabels = resource.metadata?.labels;
    const spec = resource.spec as
        | { template?: { metadata?: { labels?: Record<string, string> } } }
        | undefined;
    return metadataLabels ?? spec?.template?.metadata?.labels;
}

/** The labels the pods created by a workload would carry (template first, then selector, then metadata).
 *  CronJobs carry the pod template labels under spec.jobTemplate.spec.template. */
export function getWorkloadPodLabels(resource: K8sResource): Record<string, string> | undefined {
    const spec = resource.spec as
        | {
              template?: { metadata?: { labels?: Record<string, string> } };
              jobTemplate?: { spec?: { template?: { metadata?: { labels?: Record<string, string> } } } };
          }
        | undefined;
    if (resource.kind === 'CronJob') {
        return (
            spec?.jobTemplate?.spec?.template?.metadata?.labels ??
            getSelector(resource) ??
            resource.metadata?.labels
        );
    }
    return spec?.template?.metadata?.labels ?? getSelector(resource) ?? resource.metadata?.labels;
}

/**
 * The Pod spec of a resource: `spec` for Pods, `spec.template.spec` for
 * Deployment/ReplicaSet/Job, and `spec.jobTemplate.spec.template.spec` for
 * CronJobs (their Pods are described inside the Job template).
 */
function podSpecOf(resource: K8sResource): Record<string, any> | undefined {
    const spec = resource.spec as Record<string, any> | undefined;
    if (resource.kind === 'Pod') return spec;
    if (resource.kind === 'CronJob') return spec?.jobTemplate?.spec?.template?.spec;
    return spec?.template?.spec;
}

export function matchesSelector(
    selector: Record<string, string>,
    labels: Record<string, string> | undefined
): boolean {
    if (!labels || Object.keys(selector).length === 0) return false;
    return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

export function getIngressServiceNames(resource: K8sResource): string[] {
    const spec = resource.spec as {
        rules?: Array<{
            http?: {
                paths?: Array<{
                    backend?: { service?: { name?: string } };
                }>;
            };
        }>;
    } | undefined;

    const names: string[] = [];
    spec?.rules?.forEach((rule) => {
        rule.http?.paths?.forEach((path) => {
            const name = path.backend?.service?.name;
            if (name) names.push(name);
        });
    });
    return names;
}

/** The Secret names an Ingress terminates TLS with (from spec.tls[].secretName). */
export function getIngressTlsSecretNames(resource: K8sResource): string[] {
    const spec = resource.spec as
        | { tls?: Array<{ secretName?: string; hosts?: string[] }> }
        | undefined;

    const names: string[] = [];
    const seen = new Set<string>();
    spec?.tls?.forEach((tls) => {
        const name = tls?.secretName;
        if (typeof name === 'string' && name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    });
    return names;
}

/** The workload a HorizontalPodAutoscaler scales (from spec.scaleTargetRef). */
export function getHpaTarget(
    resource: K8sResource
): { kind: 'Deployment' | 'ReplicaSet'; name: string } | undefined {
    const spec = resource.spec as
        | { scaleTargetRef?: { kind?: string; name?: string } }
        | undefined;
    const ref = spec?.scaleTargetRef;
    if (!ref || !ref.name || (ref.kind !== 'Deployment' && ref.kind !== 'ReplicaSet')) {
        return undefined;
    }
    return { kind: ref.kind, name: ref.name };
}

/** The resource a VerticalPodAutoscaler right-sizes (from spec.targetRef). A VPA
 *  points at the pod controller — Deployment/ReplicaSet/Job/CronJob — or at a
 *  standalone Pod, never at Pods nested inside a controller. */
export function getVpaTarget(
    resource: K8sResource
):
    | { kind: 'Deployment' | 'ReplicaSet' | 'Pod' | 'Job' | 'CronJob'; name: string }
    | undefined {
    const spec = resource.spec as
        | { targetRef?: { kind?: string; name?: string } }
        | undefined;
    const ref = spec?.targetRef;
    if (
        !ref ||
        !ref.name ||
        (ref.kind !== 'Deployment' &&
            ref.kind !== 'ReplicaSet' &&
            ref.kind !== 'Pod' &&
            ref.kind !== 'Job' &&
            ref.kind !== 'CronJob')
    ) {
        return undefined;
    }
    return { kind: ref.kind, name: ref.name };
}

/** All VPAs whose spec.targetRef points at the given kind+name (for the
 *  target's "Vertical scaled by" inspector projection). */
export function getResourcesTargetedByVpa(
    resources: K8sResource[],
    kind: 'Deployment' | 'ReplicaSet' | 'Pod' | 'Job' | 'CronJob',
    name: string
): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'VerticalPodAutoscaler' &&
            getVpaTarget(r)?.kind === kind &&
            getVpaTarget(r)?.name === name
    );
}

/**
 * The ConfigMap names a resource references through its Pod spec: `envFrom[].configMapRef`,
 * `env[].valueFrom.configMapKeyRef` and `volumes[].configMap`. Workloads (Deployment/ReplicaSet)
 * carry these under `spec.template.spec`; Pods use `spec` directly. Returns unique names in
 * document order.
 */
export function getConfigMapRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const names = new Set<string>();
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];

    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.configMapRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const name = env?.valueFrom?.configMapKeyRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
    });

    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.configMap?.name;
            if (typeof name === 'string') names.add(name);
        });
    }

    return [...names];
}

/**
 * The PersistentVolumeClaim names a resource references through its Pod spec:
 * `volumes[].persistentVolumeClaim.claimName`. Workloads (Deployment/ReplicaSet)
 * carry them under `spec.template.spec`; Pods use `spec` directly. Returns unique
 * claim names in document order.
 */
export function getPvcRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec || !Array.isArray(podSpec.volumes)) return [];

    const names: string[] = [];
    const seen = new Set<string>();
    podSpec.volumes.forEach((volume: any) => {
        const name = volume?.persistentVolumeClaim?.claimName;
        if (typeof name === 'string' && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    });
    return names;
}

/** All real workloads/Pods that reference the given PVC by claimName (via getPvcRefs). */
export function getResourcesUsingPvc(resources: K8sResource[], claimName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getPvcRefs(r).includes(claimName));
}

/** How a resource claims each PVC it references: the volume name + claim name, for the inspector. */
export function getPvcRefDetails(resource: K8sResource): Array<{ name: string; volumeName: string }> {
    const podSpec = podSpecOf(resource);
    if (!podSpec || !Array.isArray(podSpec.volumes)) return [];

    const entries: Array<{ name: string; volumeName: string }> = [];
    const seen = new Set<string>();
    podSpec.volumes.forEach((volume: any) => {
        const name = volume?.persistentVolumeClaim?.claimName;
        if (typeof name !== 'string' || seen.has(name)) return;
        seen.add(name);
        entries.push({ name, volumeName: typeof volume?.name === 'string' ? volume.name : '' });
    });
    return entries;
}

/** The PV a PVC binds to by name (from spec.volumeName), or undefined when unbound. */
export function getPvForPvc(pvc: K8sResource): string | undefined {
    const spec = pvc.spec as { volumeName?: unknown } | undefined;
    return typeof spec?.volumeName === 'string' && spec.volumeName ? spec.volumeName : undefined;
}

/** The StorageClass a PVC references (from spec.storageClassName), or undefined. */
export function getStorageClassForPvc(pvc: K8sResource): string | undefined {
    const spec = pvc.spec as { storageClassName?: unknown } | undefined;
    return typeof spec?.storageClassName === 'string' && spec.storageClassName
        ? spec.storageClassName
        : undefined;
}

/** All PVCs bound to the given PV by name (spec.volumeName). */
export function getPvcsBoundToPv(resources: K8sResource[], pvName: string): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'PersistentVolumeClaim' && getPvForPvc(r) === pvName
    );
}

/** All PVCs referencing the given StorageClass by name (spec.storageClassName). */
export function getPvcsBoundToStorageClass(
    resources: K8sResource[],
    scName: string
): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'PersistentVolumeClaim' && getStorageClassForPvc(r) === scName
    );
}

/** All resources that reference the given ConfigMap by name (via getConfigMapRefs). */
export function getResourcesUsingConfigMap(resources: K8sResource[], cmName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getConfigMapRefs(r).includes(cmName));
}

/**
 * How a resource consumes each ConfigMap it references, for inspector display:
 * `envFrom` (inject all keys), `envKey` (single key via configMapKeyRef, with the
 * key), `volumes` (mounted as a volume). One entry per mechanism per ConfigMap.
 */
export function getConfigMapRefDetails(resource: K8sResource): Array<{
    name: string;
    mechanism: 'envFrom' | 'envKey' | 'volumes';
    key?: string;
}> {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const entries: Array<{ name: string; mechanism: 'envFrom' | 'envKey' | 'volumes'; key?: string }> = [];
    const seen = new Set<string>();
    const push = (name: string, mechanism: 'envFrom' | 'envKey' | 'volumes', key?: string) => {
        const id = `${name}:${mechanism}:${key ?? ''}`;
        if (seen.has(id)) return;
        seen.add(id);
        entries.push({ name, mechanism, ...(key ? { key } : {}) });
    };

    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.configMapRef?.name;
                if (typeof name === 'string') push(name, 'envFrom');
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const ref = env?.valueFrom?.configMapKeyRef;
                if (typeof ref?.name === 'string') push(ref.name, 'envKey', ref.key);
            });
        }
    });
    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.configMap?.name;
            if (typeof name === 'string') push(name, 'volumes');
        });
    }
    return entries;
}

/**
 * The Secret names a resource references through its Pod spec: `envFrom[].secretRef`,
 * `env[].valueFrom.secretKeyRef` and `volumes[].secret.secretName`. Workloads
 * (Deployment/ReplicaSet) carry these under `spec.template.spec`; Pods use `spec`
 * directly. Returns unique names in document order.
 */
export function getSecretRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const names = new Set<string>();
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];

    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.secretRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const name = env?.valueFrom?.secretKeyRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
    });

    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.secret?.secretName;
            if (typeof name === 'string') names.add(name);
        });
    }

    return [...names];
}

/**
 * How a resource consumes each Secret it references, for inspector display:
 * `envFrom` (inject all keys), `envKey` (single key via secretKeyRef, with the
 * key), `volumes` (mounted as a volume). One entry per mechanism per Secret.
 */
export function getSecretRefDetails(resource: K8sResource): Array<{
    name: string;
    mechanism: 'envFrom' | 'envKey' | 'volumes';
    key?: string;
}> {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const entries: Array<{ name: string; mechanism: 'envFrom' | 'envKey' | 'volumes'; key?: string }> = [];
    const seen = new Set<string>();
    const push = (name: string, mechanism: 'envFrom' | 'envKey' | 'volumes', key?: string) => {
        const id = `${name}:${mechanism}:${key ?? ''}`;
        if (seen.has(id)) return;
        seen.add(id);
        entries.push({ name, mechanism, ...(key ? { key } : {}) });
    };

    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.secretRef?.name;
                if (typeof name === 'string') push(name, 'envFrom');
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const ref = env?.valueFrom?.secretKeyRef;
                if (typeof ref?.name === 'string') push(ref.name, 'envKey', ref.key);
            });
        }
    });
    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.secret?.secretName;
            if (typeof name === 'string') push(name, 'volumes');
        });
    }
    return entries;
}

/** All real workloads/Pods that reference the given Secret by name (via getSecretRefs). */
export function getResourcesUsingSecret(resources: K8sResource[], secretName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getSecretRefs(r).includes(secretName));
}

/** The GatewayClass a Gateway references (spec.gatewayClassName), or undefined. */
export function getGatewayClassName(gateway: K8sResource): string | undefined {
    const spec = gateway.spec as { gatewayClassName?: unknown } | undefined;
    const name = spec?.gatewayClassName;
    return typeof name === 'string' && name.trim() ? name : undefined;
}

/** The Gateway names a route attaches to (spec.parentRefs[].name), in document order. */
export function getRouteParentRefNames(route: K8sResource): string[] {
    const spec = route.spec as { parentRefs?: Array<{ name?: unknown }> } | undefined;
    if (!Array.isArray(spec?.parentRefs)) return [];
    return spec.parentRefs
        .filter((ref) => ref && typeof ref.name === 'string' && ref.name.trim())
        .map((ref) => ref.name as string);
}

/** The Service names a route routes to (spec.backendRefs[].name), in document order. */
export function getRouteBackendRefNames(route: K8sResource): string[] {
    const spec = route.spec as { backendRefs?: Array<{ name?: unknown }> } | undefined;
    if (!Array.isArray(spec?.backendRefs)) return [];
    return spec.backendRefs
        .filter((ref) => ref && typeof ref.name === 'string' && ref.name.trim())
        .map((ref) => ref.name as string);
}

/** All Gateways referencing the given GatewayClass by name (spec.gatewayClassName). */
export function getGatewaysUsingClass(resources: K8sResource[], className: string): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'Gateway' && getGatewayClassName(r) === className
    );
}

/** All Routes attached to the given Gateway by name (spec.parentRefs[].name). */
export function getRoutesForGateway(resources: K8sResource[], gatewayName: string): K8sResource[] {
    return resources.filter(
        (r) => isRouteKind(r.kind) && getRouteParentRefNames(r).includes(gatewayName)
    );
}

/** All Routes routing to the given Service by name (spec.backendRefs[].name). */
export function getRoutesForService(resources: K8sResource[], serviceName: string): K8sResource[] {
    return resources.filter(
        (r) => isRouteKind(r.kind) && getRouteBackendRefNames(r).includes(serviceName)
    );
}
