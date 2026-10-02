import { isClusterScoped } from '../../utils/k8sScope';
import { placeNewNamespaceRect } from '../../utils/placement';
import {
    clampRectToRect,
    NAMESPACE_MIN_RECT,
    resolveMoveCollision,
    resolveResizeCollision,
    type NsLayout,
    type Rect,
} from '../../utils/teachingFrame';
import { collectWithDescendants, commitResources, toResources } from '../graphCommit';
import {
    clearSavedPositions,
    ensureNsLayout,
    namespaceContentRects,
    persistNsLayout,
    upsertNamedRect,
} from '../persistence';
import { makeNotice, type StoreGetter, type StoreSetter, type VeltraState } from '../types';

export function createNsLayoutActions(
    set: StoreSetter,
    get: StoreGetter
): Pick<
    VeltraState,
    | 'setNsEditMode'
    | 'moveNamespace'
    | 'moveClusterRect'
    | 'resizeNsRect'
    | 'resizeClusterRect'
    | 'addNamespace'
    | 'deleteNamespace'
> {
    return {
        setNsEditMode: (on: boolean) => {
            if (!on) {
                // Auto-persist the layout when leaving namespace editing mode,
                // but only if the user actually edited it (null = pure auto-layout).
                const layout = get().nsLayout;
                if (layout) persistNsLayout(layout);
            }
            set({ nsEditMode: on });
        },

        moveNamespace: (name: string, rect: Rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // Namespace rectangles never collide: the dragged rect is pushed out
                // of every other namespace rect before the translation is computed.
                const others = layout.namespaces.filter((ns) => ns.name !== name);
                // …and it can never leave the cluster: sibling resolution first, then
                // a final clamp to the cluster bounds wins (a dragged box stays inside
                // even when the cluster has no spare room (containment over overlap).
                const clamped = clampRectToRect(
                    resolveMoveCollision(rect, others),
                    layout.cluster
                );
                // Translation is the diff between the passed rect and the one the
                // layout currently holds; the caller may pass absolute rects
                // anchored at drag start without double-applying.
                const old = layout.namespaces.find((ns) => ns.name === name);
                const dx = old ? clamped.x - old.x : 0;
                const dy = old ? clamped.y - old.y : 0;
                // Only top-level namespaced nodes ride along with their rectangle;
                // nested children (Pods inside RSs/Deployments) follow via their
                // parent's absolute position and cluster-scoped kinds never move
                // with a namespace.
                const nextNodes = state.nodes.map((n) => {
                    if (n.parentId) return n;
                    if (isClusterScoped(n.data.kind)) return n;
                    if ((n.data.namespace ?? 'default') !== name) return n;
                    return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
                });
                return {
                    nodes: nextNodes,
                    nsLayout: {
                        ...layout,
                        namespaces: upsertNamedRect(layout.namespaces, name, clamped),
                    },
                };
            }),

        moveClusterRect: (cluster: Rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const dx = cluster.x - layout.cluster.x;
                const dy = cluster.y - layout.cluster.y;
                // The whole cluster translates: every top-level node (namespaced
                // and cluster-scoped alike) plus all namespace rectangles.
                const nextNodes = state.nodes.map((n) =>
                    n.parentId ? n : { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
                );
                const namespaces = layout.namespaces.map((ns) => ({
                    ...ns,
                    x: ns.x + dx,
                    y: ns.y + dy,
                }));
                return { nodes: nextNodes, nsLayout: { cluster, namespaces } };
            }),

        resizeNsRect: (name: string, rect: Rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // Resize never collides either: growth is stopped at the nearest
                // neighbor's facing edge (west/north drags stop at its trailing
                // edge), a shrink can't leave a contained resource outside the
                // box, and the box can't extend outside the cluster.
                const old = layout.namespaces.find((ns) => ns.name === name);
                const others = layout.namespaces.filter((ns) => ns.name !== name);
                const clamped = old
                    ? resolveResizeCollision(
                          old,
                          rect,
                          others,
                          NAMESPACE_MIN_RECT,
                          namespaceContentRects(state.nodes, name),
                          layout.cluster
                      )
                    : rect;
                return {
                    nsLayout: {
                        ...layout,
                        namespaces: upsertNamedRect(layout.namespaces, name, clamped),
                    },
                };
            }),

        resizeClusterRect: (rect: Rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                // The cluster can't shrink past its namespace boxes either (they
                // act as its content); otherwise a box would end up outside.
                const clamped = resolveResizeCollision(
                    layout.cluster,
                    rect,
                    [],
                    NAMESPACE_MIN_RECT,
                    [...layout.namespaces]
                );
                return { nsLayout: { ...layout, cluster: clamped } };
            }),

        addNamespace: (name: string, rect?: Rect) =>
            set((state) => {
                const layout = ensureNsLayout(state);
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Namespace name cannot be empty.') };
                }
                // Duplicates cover persisted rectangles AND namespaces currently
                // discovered from the graph (YAML-authored, never edited).
                const exists =
                    layout.namespaces.some((ns) => ns.name === trimmed) ||
                    state.nodes.some(
                        (n) =>
                            !n.data.synthetic &&
                            !isClusterScoped(n.data.kind) &&
                            (n.data.namespace ?? 'default') === trimmed
                    );
                if (exists) {
                    return {
                        notice: makeNotice(
                            'error',
                            `Namespace “${trimmed}” already exists on the canvas.`
                        ),
                    };
                }
                // The new rect always lands INSIDE the cluster (first free pocket);
                // when there is no room, the cluster grows to fit it, exactly like
                // repairPlacements grows boxes for new resources.
                const placed = placeNewNamespaceRect(
                    layout,
                    rect?.width ?? 320,
                    rect?.height ?? 240,
                    {
                        x: rect?.x ?? layout.cluster.x + 20,
                        y: rect?.y ?? layout.cluster.y + 20,
                    }
                );
                return {
                    nsLayout: {
                        ...layout,
                        cluster: placed.cluster,
                        namespaces: [
                            ...layout.namespaces,
                            { name: trimmed, ...placed.rect },
                        ],
                    },
                    notice: makeNotice(
                        'success',
                        `Namespace “${trimmed}” added; drag resources onto it to assign them.`
                    ),
                };
            }),

        deleteNamespace: (name: string) =>
            set((state) => {
                const trimmed = (name ?? '').trim();
                if (!trimmed) {
                    return { notice: makeNotice('error', 'Namespace name cannot be empty.') };
                }
                // Cascade like Kubernetes: every top-level real resource living in
                // the namespace is deleted, and its nested descendants (Pods under
                // RS under Deployment) go with it via collectWithDescendants.
                const topLevelInNs = state.nodes.filter(
                    (n) =>
                        !n.parentId &&
                        !n.data.synthetic &&
                        !isClusterScoped(n.data.kind) &&
                        (n.data.namespace ?? 'default') === trimmed
                );
                const doomed = new Set<string>();
                topLevelInNs.forEach((n) => {
                    collectWithDescendants(state.nodes, n.id).forEach((id) => doomed.add(id));
                });

                const layout = ensureNsLayout(state);
                const namespaces = layout.namespaces.filter((ns) => ns.name !== trimmed);
                const nsLayout: NsLayout = { ...layout, namespaces };

                // Empty namespace: pure layout change; never touch YAML or the
                // graph (serializing would destroy user comments/formatting).
                if (doomed.size === 0) {
                    return {
                        nsLayout,
                        notice: makeNotice('success', `Namespace “${trimmed}” deleted.`),
                    };
                }

                const remaining = state.nodes.filter((n) => !doomed.has(n.id));
                // Namespace deletion takes its resources' position pins with it.
                clearSavedPositions(
                    state.nodes
                        .filter((n) => doomed.has(n.id))
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );
                const userEdges = state.userEdges.filter(
                    (e) => !doomed.has(e.source) && !doomed.has(e.target)
                );
                const sel = state.selectedResource;
                const selectionRemoved =
                    sel &&
                    !remaining.some(
                        (n) => n.data.kind === sel.kind && n.data.name === sel.name
                    );

                return {
                    ...commitResources(state, toResources(remaining), remaining, {
                        userEdges,
                        selectedResource: selectionRemoved ? null : sel,
                    }),
                    nsLayout,
                    notice: makeNotice(
                        'success',
                        `Namespace “${trimmed}” deleted with ${doomed.size} resource${doomed.size > 1 ? 's' : ''}.`
                    ),
                };
            }),
    };
}
