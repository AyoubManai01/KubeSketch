import { Position, type Node, type Edge } from '@xyflow/react';
import type { K8sResource, SupportedKind } from '../types/types';

/** Data payload we attach to each React Flow node */
export interface K8sNodeData {
    kind: SupportedKind;
    name: string;
    namespace?: string;
    resource: K8sResource;
    [key: string]: unknown;
}

const LAYER_Y: Record<SupportedKind, number> = {
    Ingress: 80,
    Service: 300,
    Deployment: 520,
    ReplicaSet: 740,
    Pod: 960,
};

const LANE_ORDER: SupportedKind[] = ['Ingress', 'Service', 'Deployment', 'ReplicaSet', 'Pod'];
const COLUMN_GAP = 360;
const CANVAS_CENTER_X = 900;

/**
 * Convert an array of parsed K8s resources into React Flow nodes.
 *
 * - Each resource becomes one node in an architecture lane layout
 * - Edges are inferred from known K8s references/selectors
 */
export function buildGraph(resources: K8sResource[]): {
    nodes: Node<K8sNodeData>[];
    edges: Edge[];
} {
    const laneCounts: Record<SupportedKind, number> = {
        Ingress: 0,
        Service: 0,
        Deployment: 0,
        ReplicaSet: 0,
        Pod: 0,
    };
    resources.forEach((res) => {
        laneCounts[res.kind as SupportedKind] += 1;
    });

    const laneColumnCursor: Record<SupportedKind, number> = {
        Ingress: 0,
        Service: 0,
        Deployment: 0,
        ReplicaSet: 0,
        Pod: 0,
    };

    const nodes: Node<K8sNodeData>[] = resources.map((res, index) => {
        const kind = res.kind as SupportedKind;
        const col = laneColumnCursor[kind];
        laneColumnCursor[kind] += 1;
        const laneCount = laneCounts[kind];
        const laneStartX = CANVAS_CENTER_X - ((laneCount - 1) * COLUMN_GAP) / 2;

        return {
            id: `${res.kind}-${res.metadata.name}-${index}`,
            type: 'k8sNode', // custom node type registered in React Flow
            position: {
                x: laneStartX + col * COLUMN_GAP,
                y: LAYER_Y[kind],
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            data: {
                kind,
                name: res.metadata.name,
                namespace: res.metadata.namespace,
                resource: res,
            },
        };
    });

    const byName = new Map<string, Node<K8sNodeData>>();
    nodes.forEach((node) => byName.set(node.data.name, node));
    const edgeSet = new Set<string>();
    const edges: Edge[] = [];

    const addEdge = (source: Node<K8sNodeData> | undefined, target: Node<K8sNodeData> | undefined, label: string) => {
        if (!source || !target) return;
        const id = `${source.id}->${target.id}:${label}`;
        if (edgeSet.has(id)) return;
        edgeSet.add(id);
        edges.push({
            id,
            source: source.id,
            target: target.id,
            label,
            animated: label !== 'owns',
            style: { stroke: '#89a8d1', strokeWidth: 2.2 },
        });
    };

    nodes.forEach((node) => {
        const res = node.data.resource;
        if (res.kind === 'Ingress') {
            const serviceNames = getIngressServiceNames(res);
            serviceNames.forEach((serviceName) =>
                addEdge(node, byName.get(serviceName), 'routes')
            );
        }

        if (res.kind === 'Service') {
            const selector = getSelector(res);
            if (!selector) return;
            nodes.forEach((target) => {
                if (target.id === node.id) return;
                const labels = getTargetLabels(target.data.resource);
                if (matchesSelector(selector, labels)) {
                    addEdge(node, target, 'selects');
                }
            });
        }

        if (res.kind === 'Deployment') {
            const target = nodes.find(
                (n) =>
                    n.data.kind === 'ReplicaSet' &&
                    startsWithResourceName(n.data.name, res.metadata.name)
            );
            addEdge(node, target, 'owns');
        }

        if (res.kind === 'ReplicaSet') {
            const pods = nodes.filter(
                (n) =>
                    n.data.kind === 'Pod' &&
                    startsWithResourceName(n.data.name, res.metadata.name)
            );
            if (pods.length) {
                pods.forEach((pod) => addEdge(node, pod, 'manages'));
            }
        }
    });

    // Add visual top-down chain hints when matching layers exist.
    LANE_ORDER.forEach((kind, idx) => {
        if (idx === LANE_ORDER.length - 1) return;
        const src = nodes.find((n) => n.data.kind === kind);
        const dst = nodes.find((n) => n.data.kind === LANE_ORDER[idx + 1]);
        if (src && dst) {
            addEdge(src, dst, 'flow');
        }
    });

    return { nodes, edges };
}

function startsWithResourceName(name: string, parentName: string): boolean {
    return name === parentName || name.startsWith(`${parentName}-`);
}

function getSelector(resource: K8sResource): Record<string, string> | undefined {
    const spec = resource.spec as { selector?: Record<string, string> } | undefined;
    return spec?.selector;
}

function getTargetLabels(resource: K8sResource): Record<string, string> | undefined {
    const metadataLabels = resource.metadata?.labels;
    const spec = resource.spec as
        | { template?: { metadata?: { labels?: Record<string, string> } } }
        | undefined;
    return metadataLabels ?? spec?.template?.metadata?.labels;
}

function matchesSelector(
    selector: Record<string, string>,
    labels: Record<string, string> | undefined
): boolean {
    if (!labels) return false;
    return Object.entries(selector).every(([k, v]) => labels[k] === v);
}

function getIngressServiceNames(resource: K8sResource): string[] {
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
