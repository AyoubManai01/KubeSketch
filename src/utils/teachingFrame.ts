import type { Node } from '@xyflow/react';
import type { K8sNodeData } from './buildGraph';
import { isClusterScoped } from './k8sScope';

/** Axis-aligned rectangle in canvas (flow) coordinates. */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A namespace rectangle: `name` is the unique key (metadata.namespace value). */
export interface NamespaceRect extends Rect {
    name: string;
}

/** The cluster rectangle + all namespace rectangles (user-editable layout). */
export interface NsLayout {
    cluster: Rect;
    namespaces: NamespaceRect[];
}

/** Fallback cluster rectangle when the canvas has no nodes yet. */
export const DEFAULT_CLUSTER_RECT: Rect = { x: 20, y: 20, width: 1200, height: 1400 };

export const FALLBACK_NODE_WIDTH = 220;
export const FALLBACK_NODE_HEIGHT = 130;

/**
 * Compute the Cluster/namespace guide frames from the *top-level* nodes only,
 * using each node's real width/height. Child nodes have parent-relative
 * coordinates and must not participate in absolute bounds.
 *
 * Cluster-scoped kinds (PersistentVolume, StorageClass) live inside the cluster
 * rectangle but OUTSIDE any namespace rectangle — they are never grouped.
 */
export function buildTeachingFrame(nodes: Node<K8sNodeData>[]): NsLayout | null {
    const topLevel = nodes.filter((n) => !n.parentId);
    if (!topLevel.length) return null;
    const cluster = getNodeBounds(topLevel, 90, 110);

    const namespaced = topLevel.filter((n) => !isClusterScoped(n.data.kind));
    const namespaceMap = new Map<string, Node<K8sNodeData>[]>();
    namespaced.forEach((node) => {
        const key = node.data?.namespace ?? 'default';
        const list = namespaceMap.get(key) ?? [];
        list.push(node);
        namespaceMap.set(key, list);
    });

    const namespaces: NamespaceRect[] = Array.from(namespaceMap.entries()).map(
        ([namespace, members]) => {
            const bounds = getNodeBounds(members, 40, 46);
            return { name: namespace, ...bounds };
        }
    );

    return { cluster, namespaces };
}

/**
 * The layout to render: user-persisted rectangles (from `nsLayout`) merged with
 * namespaces auto-discovered from the current nodes. Auto-discovered namespaces
 * that were never edited get auto-derived bounds; the cluster rect comes from
 * the persisted layout when present, else from the node bounds.
 */
export function effectiveNsLayout(
    nsLayout: NsLayout | null,
    nodes: Node<K8sNodeData>[]
): NsLayout {
    const auto = buildTeachingFrame(nodes);
    const cluster = nsLayout?.cluster ?? auto?.cluster ?? { ...DEFAULT_CLUSTER_RECT };
    const merged = new Map((nsLayout?.namespaces ?? []).map((ns) => [ns.name, ns]));
    const discovered = new Map((auto?.namespaces ?? []).map((ns) => [ns.name, ns]));
    discovered.forEach((ns, name) => {
        if (!merged.has(name)) merged.set(name, ns);
    });
    return { cluster, namespaces: Array.from(merged.values()) };
}

/** True when the point lies inside the rectangle. */
export function rectContains(rect: Rect, point: { x: number; y: number }): boolean {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

function getNodeBounds(nodes: Node<K8sNodeData>[], xPad: number, yPad: number): Rect {
    const bounds = nodes.reduce(
        (acc, node) => {
            const width =
                typeof node.style?.width === 'number'
                    ? node.style.width
                    : FALLBACK_NODE_WIDTH;
            const height =
                typeof node.style?.height === 'number'
                    ? node.style.height
                    : FALLBACK_NODE_HEIGHT;
            return {
                minX: Math.min(acc.minX, node.position.x),
                maxX: Math.max(acc.maxX, node.position.x + width),
                minY: Math.min(acc.minY, node.position.y),
                maxY: Math.max(acc.maxY, node.position.y + height),
            };
        },
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    return {
        x: bounds.minX - xPad,
        y: bounds.minY - yPad,
        width: bounds.maxX - bounds.minX + xPad * 2,
        height: bounds.maxY - bounds.minY + yPad * 2,
    };
}
