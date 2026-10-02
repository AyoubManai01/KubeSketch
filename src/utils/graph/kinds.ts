import { type Node } from '@xyflow/react';
import type { K8sNodeData } from './graphTypes';

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
    if (kind === 'Deployment' || kind === 'Pod' || kind === 'ReplicaSet' ||
        kind === 'HorizontalPodAutoscaler' || kind === 'VerticalPodAutoscaler' || kind === 'Job' ||
        kind === 'CronJob') {
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
 * in a Route's backendRefs are intentionally NEVER collected: a Route routes TO a
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

/** Canonical React Flow node ID for a resource. Kept stable and derivable everywhere. */
export function nodeIdFor(kind: string, name: string): string {
    return `${kind}-${name}`;
}
