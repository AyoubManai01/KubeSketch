import { type Edge, type Node } from '@xyflow/react';
import { buildTeachingFrame, DEFAULT_CLUSTER_RECT, FALLBACK_NODE_HEIGHT, FALLBACK_NODE_WIDTH, type NamespaceRect, type NsLayout, type Rect } from '../utils/teachingFrame';
import { isClusterScoped } from '../utils/k8sScope';
import type { K8sNodeData } from '../utils/buildGraph';
import { NS_LAYOUT_KEY, POSITIONS_KEY, USER_EDGES_KEY } from './constants';import type { KubeSketchState } from './types';

export function readUserEdges(): Edge[] {
    try {
        const saved = localStorage.getItem(USER_EDGES_KEY);
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export function persistUserEdges(edges: Edge[]) {
    try {
        // Strip transient UI state; a persisted `selected: true` would restore the
        // edge elevated above nodes on the next load and swallow their pointer events.
        const sanitized = edges.map((edge) => {
            const rest = { ...edge };
            delete rest.selected;
            return rest;
        });
        localStorage.setItem(USER_EDGES_KEY, JSON.stringify(sanitized));
    } catch (e) {
        console.error('Failed to save manual edges to storage', e);
    }
}

/** Merge the given position entries into storage without touching other entries. */
export function mergePositionsIntoStorage(
    entries: Array<{ key: string; value: { x: number; y: number } }>
) {
    if (!entries.length) return;
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        const positions: Record<string, { x: number; y: number }> = saved ? JSON.parse(saved) : {};
        entries.forEach(({ key, value }) => {
            positions[key] = value;
        });
        localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch (e) {
        console.error('Failed to save positions to storage', e);
    }
}

export function renameStoredPosition(oldKey: string, newKey: string) {
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        if (positions[oldKey]) {
            positions[newKey] = positions[oldKey];
            delete positions[oldKey];
            localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
        }
    } catch {}
}

/** Remove saved positions for the given `Kind:name` keys. Used so a re-created
 *  resource never inherits a stale pinned position from a previously deleted
 *  one; creation and namespace reassignment always get fresh, repaired
 *  placement (inside the namespace box, overlap-free, with growth). */
export function clearSavedPositions(keys: string[]) {
    if (!keys.length) return;
    try {
        const saved = localStorage.getItem(POSITIONS_KEY);
        if (!saved) return;
        const positions = JSON.parse(saved);
        let changed = false;
        keys.forEach((key) => {
            if (positions[key]) {
                delete positions[key];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
    } catch {}
}

// ─── Namespace layout storage helpers ────────────────────────────────────────

/** The layout to edit: the persisted one, or a fresh auto-derivation from the
 *  current graph (so unedited layouts always hug the live nodes). */
export function ensureNsLayout(state: KubeSketchState): NsLayout {
    if (state.nsLayout) return state.nsLayout;
    return (
        buildTeachingFrame(state.nodes) ?? {
            cluster: { ...DEFAULT_CLUSTER_RECT },
            namespaces: [],
        }
    );
}

/** The top-level real resources living in the given namespace, as rectangles:
 *  a namespace box can never shrink past its own resources. */
export function namespaceContentRects(nodes: Node<K8sNodeData>[], name: string): Rect[] {
    return nodes
        .filter(
            (n) =>
                !n.parentId &&
                !n.data.synthetic &&
                !isClusterScoped(n.data.kind) &&
                (n.data.namespace ?? 'default') === name
        )
        .map((n) => ({
            x: n.position.x,
            y: n.position.y,
            width: typeof n.style?.width === 'number' ? n.style.width : FALLBACK_NODE_WIDTH,
            height: typeof n.style?.height === 'number' ? n.style.height : FALLBACK_NODE_HEIGHT,
        }));
}

export function readNsLayout(): NsLayout | null {
    try {
        const saved = localStorage.getItem(NS_LAYOUT_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved);
        const isValidRect = (r: unknown): r is Rect =>
            !!r &&
            typeof (r as Rect).x === 'number' &&
            typeof (r as Rect).y === 'number' &&
            typeof (r as Rect).width === 'number' &&
            typeof (r as Rect).height === 'number';
        if (!isValidRect(parsed?.cluster)) return null;
        const isNamedRect = (r: unknown): r is NamespaceRect =>
            isValidRect(r) &&
            typeof (r as NamespaceRect).name === 'string' &&
            (r as NamespaceRect).name.length > 0;
        const namespaces = Array.isArray(parsed?.namespaces)
            ? (parsed.namespaces as unknown[]).filter(isNamedRect)
            : [];
        // Back-compat: layouts persisted while physical nodes existed may carry
        // a `nodes` key; it is ignored (nodes are gone; the cluster/namespaces
        // are still valid).
        return { cluster: parsed.cluster, namespaces };
    } catch {
        return null;
    }
}

export function persistNsLayout(layout: NsLayout) {
    try {
        localStorage.setItem(NS_LAYOUT_KEY, JSON.stringify(layout));
    } catch (e) {
        console.error('Failed to save namespace layout to storage', e);
    }
}

/** Upsert a rectangle into a list of named rectangles (namespaces or physical
 *  nodes); used for auto-discovered entries being edited for the first time. */
export function upsertNamedRect<T extends { name: string }>(
    rects: T[],
    name: string,
    rect: Rect
): T[] {
    const idx = rects.findIndex((r) => r.name === name);
    if (idx >= 0) {
        const copy = [...rects];
        copy[idx] = { ...copy[idx], ...rect };
        return copy;
    }
    return [...rects, { name, ...rect } as unknown as T];
}
