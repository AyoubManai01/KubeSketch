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

/**
 * A canvas-only physical k8s node rectangle: `name` is the unique key.
 * Node rects live inside the cluster, never overlap each other, and hold
 * namespace rectangles — but namespaces may straddle any number of node
 * rects (the geometric overlap IS the node membership).
 */
export interface NodeRect extends Rect {
    name: string;
}

/** The cluster rectangle + all node/namespace rectangles (user-editable layout). */
export interface NsLayout {
    cluster: Rect;
    /** Physical nodes — never auto-derived, present only once the user creates them. */
    nodes: NodeRect[];
    namespaces: NamespaceRect[];
}

/** Fallback cluster rectangle when the canvas has no nodes yet. */
export const DEFAULT_CLUSTER_RECT: Rect = { x: 20, y: 20, width: 1200, height: 1400 };

export const FALLBACK_NODE_WIDTH = 220;
export const FALLBACK_NODE_HEIGHT = 130;

/** Smallest a namespace rectangle may be shrunk to (resize handles). */
export const NAMESPACE_MIN_RECT = 80;

/** Smallest a physical node rectangle may be shrunk to (resize handles). */
export const NODE_MIN_RECT = 120;

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

    // Physical nodes are never auto-derived from the graph — they exist only
    // once the user creates them (persisted in the layout).
    return { cluster, nodes: [], namespaces };
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
    const nodeRects = nsLayout?.nodes ?? [];
    const merged = new Map((nsLayout?.namespaces ?? []).map((ns) => [ns.name, ns]));
    const discovered = new Map((auto?.namespaces ?? []).map((ns) => [ns.name, ns]));
    discovered.forEach((ns, name) => {
        if (!merged.has(name)) merged.set(name, ns);
    });
    return { cluster, nodes: nodeRects, namespaces: Array.from(merged.values()) };
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

/** True when `inner` is fully contained in `outer` (touching edges count as inside). */
export function rectContainsRect(inner: Rect, outer: Rect): boolean {
    return (
        inner.x >= outer.x &&
        inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width &&
        inner.y + inner.height <= outer.y + outer.height
    );
}

/** The physical node rectangles a namespace rect overlaps (straddles). */
export function nodesOfNamespace(
    ns: NamespaceRect,
    nodes: NodeRect[]
): NodeRect[] {
    return nodes.filter((n) => rectsOverlap(ns, n));
}

/** The namespace rectangles a physical node rect overlaps (contains or straddles). */
export function namespacesOfNode(
    node: NodeRect,
    namespaces: NamespaceRect[]
): NamespaceRect[] {
    return namespaces.filter((ns) => rectsOverlap(node, ns));
}

/** True when two axis-aligned rectangles overlap (strict, touching edges don't collide). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Clamp a rectangle so it stays fully inside `container` (like
 * `clampPositionToRect`, but for a full rect). Degenerate containers smaller
 * than the rect keep it anchored to the container's top-left corner.
 */
export function clampRectToRect(rect: Rect, container: Rect): Rect {
    return {
        ...rect,
        x: Math.min(Math.max(rect.x, container.x), container.x + container.width - rect.width),
        y: Math.min(Math.max(rect.y, container.y), container.y + container.height - rect.height),
    };
}

/**
 * Clamp a node's top-left corner so its box (width × height) stays fully inside
 * `container`. Degenerate containers (smaller than the node) keep the node
 * clamped to the container's edges.
 */
export function clampPositionToRect(
    x: number,
    y: number,
    width: number,
    height: number,
    container: Rect
): { x: number; y: number } {
    return {
        x: Math.min(Math.max(x, container.x), container.x + container.width - width),
        y: Math.min(Math.max(y, container.y), container.y + container.height - height),
    };
}

/**
 * Resolve a node box (x, y, width, height) that overlaps any of `blockers` by
 * pushing it out along the axis of least penetration, re-clamped to stay inside
 * `container` (null = no container bound). Used to keep cluster-scoped nodes out
 * of namespace rectangles while dragging inside the cluster.
 */
export function resolveNodeCollision(
    x: number,
    y: number,
    width: number,
    height: number,
    container: Rect | null,
    blockers: Rect[]
): { x: number; y: number } {
    let px = x;
    let py = y;
    if (container) {
        const clamped = clampPositionToRect(px, py, width, height, container);
        px = clamped.x;
        py = clamped.y;
    }
    // Cap iterations so a blocker that fills the container can't spin forever.
    for (let i = 0; i < 10; i++) {
        const blocker = blockers.find((b) => rectsOverlap({ x: px, y: py, width, height }, b));
        if (!blocker) break;
        const pushLeft = px + width - blocker.x;
        const pushRight = blocker.x + blocker.width - px;
        const pushUp = py + height - blocker.y;
        const pushDown = blocker.y + blocker.height - py;
        const dx = Math.min(pushLeft, pushRight);
        const dy = Math.min(pushUp, pushDown);
        if (dx <= dy) {
            px += pushLeft <= pushRight ? -pushLeft : pushRight;
        } else {
            py += pushUp <= pushDown ? -pushUp : pushDown;
        }
        if (container) {
            const clamped = clampPositionToRect(px, py, width, height, container);
            px = clamped.x;
            py = clamped.y;
        }
    }
    return { x: px, y: py };
}

/**
 * Push a moved rectangle out of any rectangle it overlaps in `others` (translation
 * only — the size never changes). Used so namespace rectangles never collide when
 * dragged.
 */
export function resolveMoveCollision(candidate: Rect, others: Rect[]): Rect {
    const rect = { ...candidate };
    for (let i = 0; i < 10; i++) {
        const blocker = others.find((b) => rectsOverlap(rect, b));
        if (!blocker) break;
        const pushLeft = rect.x + rect.width - blocker.x;
        const pushRight = blocker.x + blocker.width - rect.x;
        const pushUp = rect.y + rect.height - blocker.y;
        const pushDown = blocker.y + blocker.height - rect.y;
        const dx = Math.min(pushLeft, pushRight);
        const dy = Math.min(pushUp, pushDown);
        if (dx <= dy) {
            rect.x += pushLeft <= pushRight ? -pushLeft : pushRight;
        } else {
            rect.y += pushUp <= pushDown ? -pushUp : pushDown;
        }
    }
    return rect;
}

/**
 * Clamp a resize drag (candidate derived from `start` + pointer delta) so the
 * rectangle never overlaps `others` and never shrinks past its own contained
 * resources (`content` — the moving edge stops at the content's facing edge, so
 * a resource can never be left outside its namespace box). When the rectangle
 * overlaps `bounds` (the cluster), it can't extend outside it either. Edges that
 * the drag handle doesn't move stay anchored; the result never drops below
 * `minSize`.
 */
export function resolveResizeCollision(
    start: Rect,
    candidate: Rect,
    others: Rect[],
    minSize: number,
    content: Rect[] = [],
    bounds: Rect | null = null
): Rect {
    let { x, y, width, height } = candidate;
    const eastMoved = x === start.x && width !== start.width;
    const westMoved = x !== start.x;
    const southMoved = y === start.y && height !== start.height;
    const northMoved = y !== start.y;

    // Growth stops at a neighbor's facing edge (west/north drags stop at its
    // trailing edge) so the rectangle never overlaps another namespace.
    if (eastMoved && width > start.width) {
        let limit = Infinity;
        others.forEach((b) => {
            const yOverlap = y < b.y + b.height && y + height > b.y;
            const xOverlap = b.x + b.width > x && b.x < x + width;
            if (yOverlap && xOverlap) limit = Math.min(limit, b.x - x);
        });
        if (Number.isFinite(limit)) width = limit;
    }
    if (westMoved) {
        let limit = -Infinity;
        others.forEach((b) => {
            const yOverlap = y < b.y + b.height && y + height > b.y;
            const xOverlap = b.x + b.width > x && b.x < x + width;
            if (yOverlap && xOverlap) limit = Math.max(limit, b.x + b.width);
        });
        if (Number.isFinite(limit)) {
            x = Math.max(x, limit);
            width = start.x + start.width - x;
        }
    }
    if (southMoved && height > start.height) {
        let limit = Infinity;
        others.forEach((b) => {
            const xOverlap = x < b.x + b.width && x + width > b.x;
            const yOverlap = b.y + b.height > y && b.y < y + height;
            if (xOverlap && yOverlap) limit = Math.min(limit, b.y - y);
        });
        if (Number.isFinite(limit)) height = limit;
    }
    if (northMoved) {
        let limit = -Infinity;
        others.forEach((b) => {
            const xOverlap = x < b.x + b.width && x + width > b.x;
            const yOverlap = b.y + b.height > y && b.y < y + height;
            if (xOverlap && yOverlap) limit = Math.max(limit, b.y + b.height);
        });
        if (Number.isFinite(limit)) {
            y = Math.max(y, limit);
            height = start.y + start.height - y;
        }
    }

    // A shrink can never leave a contained resource outside the box: the moving
    // edge stops at the content's facing edge (only nodes that were inside at
    // drag start constrain the edge, so the rect never jumps back out).
    if (eastMoved && width < start.width) {
        let limit = -Infinity;
        content.forEach((b) => {
            const yOverlap = y < b.y + b.height && y + height > b.y;
            if (yOverlap && b.x + b.width <= start.x + start.width) {
                limit = Math.max(limit, b.x + b.width);
            }
        });
        if (Number.isFinite(limit)) width = Math.max(width, limit - x);
    }
    if (southMoved && height < start.height) {
        let limit = -Infinity;
        content.forEach((b) => {
            const xOverlap = x < b.x + b.width && x + width > b.x;
            if (xOverlap && b.y + b.height <= start.y + start.height) {
                limit = Math.max(limit, b.y + b.height);
            }
        });
        if (Number.isFinite(limit)) height = Math.max(height, limit - y);
    }
    if (westMoved && x > start.x) {
        let limit = Infinity;
        content.forEach((b) => {
            const yOverlap = y < b.y + b.height && y + height > b.y;
            if (yOverlap && b.x >= start.x) {
                limit = Math.min(limit, b.x);
            }
        });
        if (Number.isFinite(limit)) {
            x = Math.min(x, limit);
            width = start.x + start.width - x;
        }
    }
    if (northMoved && y > start.y) {
        let limit = Infinity;
        content.forEach((b) => {
            const xOverlap = x < b.x + b.width && x + width > b.x;
            if (xOverlap && b.y >= start.y) {
                limit = Math.min(limit, b.y);
            }
        });
        if (Number.isFinite(limit)) {
            y = Math.min(y, limit);
            height = start.y + start.height - y;
        }
    }

    // The box can't extend outside the cluster (while overlapping it). Edges the
    // drag handle doesn't move stay anchored: when the west/north edge is clamped
    // back into the cluster, the opposite edge is recomputed so the box never
    // grows from the wrong side (and can't slide into a neighbor).
    if (bounds) {
        const overlapsBounds =
            x < bounds.x + bounds.width &&
            x + width > bounds.x &&
            y < bounds.y + bounds.height &&
            y + height > bounds.y;
        if (overlapsBounds) {
            if (x < bounds.x) {
                const rawX = x;
                x = bounds.x;
                if (rawX !== start.x) width = start.x + start.width - x;
            }
            if (y < bounds.y) {
                const rawY = y;
                y = bounds.y;
                if (rawY !== start.y) height = start.y + start.height - y;
            }
            if (x + width > bounds.x + bounds.width) width = bounds.x + bounds.width - x;
            if (y + height > bounds.y + bounds.height) height = bounds.y + bounds.height - y;
        }
    }
    if (width < minSize) width = minSize;
    if (height < minSize) height = minSize;
    return { x, y, width, height };
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
