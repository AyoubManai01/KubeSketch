import type { Node } from '@xyflow/react';
import type { K8sNodeData } from './buildGraph';
import { isClusterScoped } from './k8sScope';
import {
    buildTeachingFrame,
    DEFAULT_CLUSTER_RECT,
    FALLBACK_NODE_HEIGHT,
    FALLBACK_NODE_WIDTH,
    rectsOverlap,
    resolveMoveCollision,
    type NsLayout,
    type Rect,
} from './teachingFrame';

/** Gap between a placed node and the edge of its namespace/cluster box. */
const EDGE_PAD = 12;
/** Gap between a placed node and any neighboring resource. */
const NODE_GAP = 24;
/** Vertical pitch of the row sweep inside a namespace box. */
const ROW_STEP = 20;
/** Cap for the row sweep so a tiny box can't cause an unbounded search. */
const MAX_ROWS = 40;
/** Cap for the cascade push when growing a box into its neighbors. */
const MAX_PUSH_CASCADE = 10;

/** Gap between a newly added namespace rect and its neighbors / the cluster edge. */
const NS_GAP = 16;
/** Vertical pitch of the free-pocket sweep when adding a namespace rect. */
const NS_SWEEP_STEP = 24;

export interface NamespaceRectPlacement {
    rect: Rect;
    cluster: Rect;
}

/**
 * Place a NEW namespace rectangle inside the cluster, mirroring
 * `repairPlacements` for resources: swept into the first free pocket that
 * avoids every existing namespace rect, and when the cluster has no room the
 * rectangle is appended below its content and the cluster GROWS to contain it
 * (grow-only, like the resource path). Never returns a rect outside the cluster.
 */
export function placeNewNamespaceRect(
    layout: NsLayout,
    width: number,
    height: number,
    preferred: { x: number; y: number }
): NamespaceRectPlacement {
    const cluster = { ...layout.cluster };
    const others = layout.namespaces;
    const overlapsOthers = (r: Rect) => others.some((o) => rectsOverlap(r, o));
    const clampX = (x: number) =>
        Math.min(
            Math.max(x, cluster.x + NS_GAP),
            cluster.x + cluster.width - width - NS_GAP
        );
    const trySpot = (x: number, y: number): Rect | null => {
        const r = { x, y, width, height };
        if (r.x < cluster.x || r.y < cluster.y) return null;
        if (
            r.x + r.width > cluster.x + cluster.width ||
            r.y + r.height > cluster.y + cluster.height
        ) {
            return null;
        }
        if (overlapsOthers(r)) return null;
        return r;
    };

    // 1. Free-pocket sweep inside the cluster: rows step downward from the
    //    preferred y; x candidates are the preferred x, the cluster's left
    //    edge and each existing rect's right edge (+ gap).
    const maxRows = Math.ceil(cluster.height / NS_SWEEP_STEP) + 8;
    for (let i = 0; i < maxRows; i++) {
        const y = Math.max(preferred.y, cluster.y + NS_GAP) + i * NS_SWEEP_STEP;
        if (y > cluster.y + cluster.height - height) break;
        const xs = new Set<number>([
            clampX(preferred.x),
            cluster.x + NS_GAP,
            ...others.map((o) => clampX(o.x + o.width + NS_GAP)),
        ]);
        for (const x of xs) {
            const spot = trySpot(x, y);
            if (spot) return { rect: spot, cluster };
        }
    }

    // 2. No pocket inside: append below the cluster's content and grow the
    //    cluster to fit (grow-only). resolveMoveCollision keeps the rect clear
    //    of any stray namespace rectangle.
    const rect = resolveMoveCollision(
        { x: cluster.x + NS_GAP, y: cluster.y + cluster.height + 40, width, height },
        others
    );
    return {
        rect,
        cluster: {
            x: cluster.x,
            y: cluster.y,
            width: Math.max(cluster.width, rect.x + rect.width - cluster.x + 40),
            height: Math.max(cluster.height, rect.y + rect.height - cluster.y + 40),
        },
    };
}

export interface PlacementResult {
    nodes: Node<K8sNodeData>[];
    /** The persisted layout, grown/pushed when the repair had to expand a box. */
    nsLayout: NsLayout | null;
    /** True when the persisted layout differs from the input (persist it back). */
    layoutChanged: boolean;
}

/**
 * Repair pass over auto-placed top-level nodes (built by buildGraph's lane
 * layout) so that newly created/pasted resources land inside their namespace
 * box (or inside the cluster for cluster-scoped kinds) and never on top of
 * another resource. Pinned (user-dragged) nodes are never moved.
 *
 * Placement search, in order:
 *   1. the lane-preferred position if already valid;
 *   2. a row sweep around it inside the owning box;
 *   3. an append below (then right of) the box's content, growing the box.
 *
 * Growth (persisted layouts only, pure auto layouts re-hug the nodes every
 * render): the box expands to cover the node, pushing any blocking sibling
 * namespace (and its resources) out of the way (down first, then right),
 * cascading through further collisions. The cluster box then grows to the hull
 * of everything it contains.
 */
export function repairPlacements(
    nodes: Node<K8sNodeData>[],
    autoPlacedIds: Set<string>,
    nsLayout: NsLayout | null
): PlacementResult {
    const topLevel = nodes.filter((n) => !n.parentId);
    // Smaller nodes yield to bigger ones when their lane spots collide (e.g. an
    // HPA auto-aligned under a tall Deployment slides aside, the Deployment
    // stays put). Stable within equal sizes keeps emission order deterministic.
    const autoNodes = topLevel
        .filter((n) => autoPlacedIds.has(n.id))
        .sort((a, b) => {
            const area = (n: Node<K8sNodeData>) =>
                (typeof n.style?.width === 'number' ? n.style.width : FALLBACK_NODE_WIDTH) *
                (typeof n.style?.height === 'number' ? n.style.height : FALLBACK_NODE_HEIGHT);
            return area(a) - area(b);
        });
    if (autoNodes.length === 0) return { nodes, nsLayout, layoutChanged: false };

    const persistedMode = nsLayout !== null;
    // Work on copies so the input layout is never mutated; the pass grows/pushes
    // these copies and returns them (only in persisted mode) when anything moved.
    const persisted = persistedMode
        ? {
              cluster: { ...nsLayout!.cluster },
              namespaces: nsLayout!.namespaces.map((ns) => ({ ...ns })),
          }
        : null;
    // Effective frames: the persisted copies + rects auto-derived from the STABLE
    // nodes only: the nodes being repaired must not drag their own frame along.
    // Every rect is an independent copy so growth/push mutations never touch the
    // input layout and change detection stays reliable.
    const stableNodes = topLevel.filter((n) => !autoPlacedIds.has(n.id));
    const auto = buildTeachingFrame(stableNodes);
    const layout: NsLayout = {
        cluster: persisted
            ? { ...persisted.cluster }
            : auto?.cluster ?? { ...DEFAULT_CLUSTER_RECT },
        namespaces: [
            ...(persisted?.namespaces.map((ns) => ({ ...ns })) ?? []),
            ...(auto?.namespaces
                .filter((ns) => !persisted?.namespaces.some((p) => p.name === ns.name))
                .map((ns) => ({ ...ns })) ?? []),
        ],
    };

    const rectOf = (n: Node<K8sNodeData>): Rect => ({
        x: n.position.x,
        y: n.position.y,
        width: typeof n.style?.width === 'number' ? n.style.width : FALLBACK_NODE_WIDTH,
        height: typeof n.style?.height === 'number' ? n.style.height : FALLBACK_NODE_HEIGHT,
    });

    // Live rect of every top-level node (stable + auto), updated on repair/push.
    const rectById = new Map<string, Rect>();
    topLevel.forEach((n) => rectById.set(n.id, rectOf(n)));

    const nodeOverlap = (r: Rect, self: Rect): boolean => {
        for (const b of rectById.values()) {
            if (b === self) continue;
            if (rectsOverlap(r, b)) return true;
        }
        return false;
    };

    const inside = (r: Rect, c: Rect): boolean =>
        r.x >= c.x && r.y >= c.y && r.x + r.width <= c.x + c.width && r.y + r.height <= c.y + c.height;

    // Final positions (id -> {x, y}) for every top-level node that moved.
    const moved = new Map<string, { x: number; y: number }>();

    /** Translate a sibling namespace's rect and its top-level resources. */
    const applyPush = (name: string, dx: number, dy: number) => {
        if (!dx && !dy) return;
        const nsRect = layout.namespaces.find((ns) => ns.name === name);
        if (nsRect) {
            nsRect.x += dx;
            nsRect.y += dy;
        }
        topLevel.forEach((n) => {
            if (isClusterScoped(n.data.kind)) return;
            if ((n.data.namespace ?? 'default') !== name) return;
            const r = rectById.get(n.id);
            if (!r) return;
            r.x += dx;
            r.y += dy;
            moved.set(n.id, { x: r.x, y: r.y });
        });
    };

    /** Extend `base` to cover `nodeRect`, pushing blocking sibling boxes away. */
    const growBase = (base: Rect, nodeRect: Rect, nsName?: string) => {
        const desired = {
            x: base.x,
            y: base.y,
            width: Math.max(base.width, nodeRect.x + nodeRect.width - base.x + EDGE_PAD),
            height: Math.max(base.height, nodeRect.y + nodeRect.height - base.y + EDGE_PAD),
        };
        if (persistedMode && nsName) {
            const siblings = layout.namespaces.filter((ns) => ns.name !== nsName);
            for (let i = 0; i < MAX_PUSH_CASCADE; i++) {
                const clash = siblings.find((ns) => rectsOverlap(desired, ns));
                if (!clash) break;
                const pushDown = clash.y >= desired.y;
                applyPush(
                    clash.name,
                    pushDown ? 0 : desired.x + desired.width - clash.x + NODE_GAP,
                    pushDown ? desired.y + desired.height - clash.y + NODE_GAP : 0
                );
            }
        }
        base.x = desired.x;
        base.y = desired.y;
        base.width = desired.width;
        base.height = desired.height;
    };

    const placeNode = (node: Node<K8sNodeData>) => {
        const nodeRect = rectById.get(node.id)!;
        const { width, height } = nodeRect;
        const namespaced = !isClusterScoped(node.data.kind);
        const nsName = node.data.namespace ?? 'default';
        const own = namespaced ? layout.namespaces.find((ns) => ns.name === nsName) : undefined;
        const foreignRects = namespaced
            ? layout.namespaces.filter((ns) => ns.name !== nsName)
            : layout.namespaces;
        const container = namespaced ? own : layout.cluster;
        // Rect-less namespaces (the first resource in a new box) still sweep
        // INSIDE the cluster in persisted mode: the cluster edges give the
        // sweep its anchors instead of falling below the cluster.
        const sweepContainer = container ?? (persistedMode ? layout.cluster : null);

        // Hard rules: never overlap another resource; in persisted mode also stay
        // inside the owning box (and out of every namespace box when cluster-
        // scoped). Pure auto layouts hug the nodes, so only overlap is enforced.
        const hardValid = (r: Rect): boolean => {
            if (nodeOverlap(r, nodeRect)) return false;
            if (persistedMode) {
                if (namespaced) {
                    if (own && !inside(r, own)) return false;
                    // A namespace with no box yet (first resource) still has to
                    // land inside the cluster, never outside it.
                    if (!own && !inside(r, layout.cluster)) return false;
                } else {
                    if (!inside(r, layout.cluster)) return false;
                    if (layout.namespaces.some((ns) => rectsOverlap(r, ns))) return false;
                }
            } else if (
                !namespaced &&
                layout.namespaces.some((ns) => rectsOverlap(r, ns))
            ) {
                return false;
            }
            return true;
        };
        // Soft rule: prefer spots outside other namespaces' boxes.
        const noForeign = (r: Rect): boolean => !foreignRects.some((ns) => rectsOverlap(r, ns));

        if (hardValid(nodeRect) && noForeign(nodeRect)) return; // already well placed

        const clampX = (x: number): number =>
            sweepContainer
                ? Math.min(
                      Math.max(x, sweepContainer.x + EDGE_PAD),
                      sweepContainer.x + sweepContainer.width - width - EDGE_PAD
                  )
                : x;

        const candidateXs = (y: number): number[] => {
            const xs = new Set<number>();
            xs.add(nodeRect.x); // the lane-preferred X
            // Blocker right-edges in the same horizontal band make natural
            // neighbors; anything farther can't collide with this row.
            for (const b of rectById.values()) {
                if (b === nodeRect) continue;
                if (b.y < y + height + NODE_GAP && b.y + b.height > y - NODE_GAP) {
                    xs.add(b.x + b.width + NODE_GAP);
                }
            }
            // Spots just beside a namespace box (for cluster-scoped kinds and
            // namespaces with no box yet).
            for (const ns of foreignRects) {
                if (ns.y < y + height + NODE_GAP && ns.y + ns.height > y - NODE_GAP) {
                    xs.add(ns.x + ns.width + NODE_GAP);
                    xs.add(ns.x - width - NODE_GAP);
                }
            }
            if (sweepContainer) {
                xs.add(sweepContainer.x + EDGE_PAD);
                xs.add(sweepContainer.x + sweepContainer.width - width - EDGE_PAD);
            }
            return Array.from(new Set(Array.from(xs).map(clampX)));
        };

        const candidateYs = (): number[] => {
            const ys = new Set<number>();
            for (let i = 0; i < MAX_ROWS; i++) {
                ys.add(nodeRect.y + i * (height + ROW_STEP));
                ys.add(nodeRect.y - i * (height + ROW_STEP));
            }
            if (sweepContainer) {
                ys.add(sweepContainer.y + EDGE_PAD);
                ys.add(sweepContainer.y + sweepContainer.height - height - EDGE_PAD);
            }
            return Array.from(ys);
        };

        const trySpot = (x: number, y: number, requireNoForeign: boolean): boolean => {
            const r = { x, y, width, height };
            if (requireNoForeign && !noForeign(r)) return false;
            if (!hardValid(r)) return false;
            nodeRect.x = r.x;
            nodeRect.y = r.y;
            moved.set(node.id, { x: r.x, y: r.y });
            return true;
        };

        // 1. Row sweep around the lane-preferred position.
        for (const y of candidateYs()) {
            for (const x of candidateXs(y)) {
                if (trySpot(x, y, true)) return;
            }
        }
        // 2. Same sweep, tolerating a foreign box (better than a node on a node).
        for (const y of candidateYs()) {
            for (const x of candidateXs(y)) {
                if (trySpot(x, y, false)) return;
            }
        }
        // 3. Append below (then right of) the box's content, growing the box.
        const base = container ?? layout.cluster;
        const appendSpots: Array<{ x: number; y: number }> = [
            { x: base.x + EDGE_PAD, y: base.y + base.height + ROW_STEP }, // below
            { x: base.x + base.width + ROW_STEP, y: base.y + EDGE_PAD }, // right
        ];
        const spotFree = (x: number, y: number): boolean => {
            const r = { x, y, width, height };
            return !nodeOverlap(r, nodeRect) && !foreignRects.some((ns) => rectsOverlap(r, ns));
        };
        let spot = appendSpots[0];
        for (const c of appendSpots) {
            if (spotFree(c.x, c.y)) {
                spot = c;
                break;
            }
        }
        nodeRect.x = spot.x;
        nodeRect.y = spot.y;
        moved.set(node.id, { x: spot.x, y: spot.y });
        // Grow the owning box to cover the node: for a cluster-scoped resource
        // (or a rect-less namespace) that's the cluster box. Sibling namespaces
        // are only ever pushed when growing a namespace's OWN rect, never when
        // the cluster grows (it contains them).
        growBase(base, nodeRect, own && base === own ? nsName : undefined);
    };

    autoNodes.forEach(placeNode);

    const nodesOut = nodes.map((n) => {
        const pos = moved.get(n.id);
        return pos ? { ...n, position: pos } : n;
    });

    if (!persistedMode) return { nodes: nodesOut, nsLayout, layoutChanged: false };

    // Cluster box grows to the hull of every node box, namespace box and
    // cluster-scoped resource it contains (grow-only: it never shrinks on
    // removal).
    const sameRect = (a: Rect, b: Rect) =>
        a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    const hull = { ...layout.cluster };
    const expand = (r: Rect) => {
        const right = r.x + r.width + EDGE_PAD * 2;
        const bottom = r.y + r.height + EDGE_PAD * 2;
        if (right > hull.x + hull.width) hull.width = right - hull.x;
        if (bottom > hull.y + hull.height) hull.height = bottom - hull.y;
    };
    layout.namespaces.forEach(expand);
    topLevel.forEach((n) => {
        if (isClusterScoped(n.data.kind)) expand(rectById.get(n.id)!);
    });
    layout.cluster = hull;

    let changed = !sameRect(layout.cluster, persisted!.cluster);
    const namespaces = persisted!.namespaces.map((pns) => {
        const eff = layout.namespaces.find((ns) => ns.name === pns.name);
        if (eff && !sameRect(eff, pns)) {
            changed = true;
            return { ...eff };
        }
        return pns;
    });
    if (changed) {
        return {
            nodes: nodesOut,
            nsLayout: {
                cluster: { ...layout.cluster },
                namespaces,
            },
            layoutChanged: true,
        };
    }
    return { nodes: nodesOut, nsLayout, layoutChanged: false };
}