import { useRef } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { useVeltraStore } from '../store/store';
import { isClusterScoped } from '../utils/k8sScope';
import {
    NAMESPACE_MIN_RECT,
    NODE_MIN_RECT,
    PROTECTED_NAMESPACES,
    nodesOfNamespace,
    rectContainsRect,
    type NsLayout,
    type Rect,
} from '../utils/teachingFrame';
import type { K8sNodeData } from '../utils/buildGraph';
import type { PointerEvent as ReactPointerEvent } from 'react';

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeDir = (typeof RESIZE_HANDLES)[number];

interface NsFrameProps {
    /** Effective (persisted + auto-discovered) cluster/namespace rectangles. */
    layout: NsLayout | null;
    nodes: Node<K8sNodeData>[];
    /** User clicked the × on a namespace frame (never fired for protected ones). */
    onDeleteNamespace: (name: string) => void;
}

interface DragOptions {
    onMove: (dx: number, dy: number) => void;
    onEnd?: () => void;
}

interface DragState {
    el: HTMLElement;
    startFlow: { x: number; y: number };
    opts: DragOptions;
}

/**
 * The Cluster + node + namespace bounding rectangles. Decorative in normal mode
 * (pointer-events none, auto-derived bounds). In a frame editing mode they
 * become draggable/resizeable surfaces:
 * - namespace editing mode: every tier is editable (dragging a namespace
 *   rectangle translates its contained top-level nodes; dragging the cluster
 *   translates everything; 8 resize handles shrink/expand any rectangle),
 * - node editing mode: only the cluster and physical node rectangles are
 *   editable — namespace rectangles stay decorative.
 */
export default function NsFrame({ layout, nodes, onDeleteNamespace }: NsFrameProps) {
    const nsEditMode = useVeltraStore((s) => s.nsEditMode);
    const nodeEditMode = useVeltraStore((s) => s.nodeEditMode);
    const moveNamespace = useVeltraStore((s) => s.moveNamespace);
    const moveClusterRect = useVeltraStore((s) => s.moveClusterRect);
    const moveNodeRect = useVeltraStore((s) => s.moveNodeRect);
    const resizeNsRect = useVeltraStore((s) => s.resizeNsRect);
    const resizeNodeRect = useVeltraStore((s) => s.resizeNodeRect);
    const resizeClusterRect = useVeltraStore((s) => s.resizeClusterRect);
    const deleteNode = useVeltraStore((s) => s.deleteNode);
    const persistNodePositions = useVeltraStore((s) => s.persistNodePositions);
    const { screenToFlowPosition } = useReactFlow();

    const dragRef = useRef<DragState | null>(null);

    if (!layout) return null;

    const allTopLevelIds = nodes.filter((n) => !n.parentId).map((n) => n.id);
    const namespaceNodeIds = (name: string) =>
        nodes
            .filter(
                (n) =>
                    !n.parentId &&
                    !isClusterScoped(n.data.kind) &&
                    (n.data.namespace ?? 'default') === name
            )
            .map((n) => n.id);
    // The namespaces FULLY contained in a node rect at drag start — only those
    // ride along when the node moves (straddling ones belong to other nodes).
    const containedNamespaceNames = (nodeRect: Rect) =>
        layout.namespaces
            .filter((ns) => rectContainsRect(ns, nodeRect))
            .map((ns) => ns.name);
    const nodeRideAlongNodeIds = (nodeRect: Rect) =>
        nodes
            .filter(
                (n) =>
                    !n.parentId &&
                    !isClusterScoped(n.data.kind) &&
                    containedNamespaceNames(nodeRect).includes(n.data.namespace ?? 'default')
            )
            .map((n) => n.id);

    const startDragAt = (e: ReactPointerEvent<HTMLElement>, opts: DragOptions) => {
        if (!nsEditMode && !nodeEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        dragRef.current = {
            el,
            startFlow: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
            opts,
        };
        el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: ReactPointerEvent) => {
        const drag = dragRef.current;
        // Events bubble from the captured element up through its ancestors
        // (inner frames live inside the cluster frame) — only the element that
        // owns the capture may apply the drag, or the cumulative delta would be
        // applied once per ancestor handler.
        if (!drag || drag.el !== e.currentTarget) return;
        const cur = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        drag.opts.onMove(cur.x - drag.startFlow.x, cur.y - drag.startFlow.y);
    };

    const onPointerEnd = (e: ReactPointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.el !== e.currentTarget) return;
        dragRef.current = null;
        drag.opts.onEnd?.();
    };

    // Cluster + physical node frames are editable in either frame mode; namespace
    // frames only in namespace editing mode (the dedicated Nodes mode keeps them
    // decorative).
    const framesEditable = nsEditMode || nodeEditMode;
    const framesEditableClass = framesEditable ? ' teaching-frame--editable' : '';
    const nsEditableClass = nsEditMode ? ' teaching-frame--editable' : '';

    return (
        <ViewportPortal>
            <div
                className={`teaching-frame teaching-frame--outer${framesEditableClass}`}
                style={{
                    width: layout.cluster.width,
                    height: layout.cluster.height,
                    transform: `translate(${layout.cluster.x}px, ${layout.cluster.y}px)`,
                }}
                onPointerDown={
                    framesEditable
                        ? (e) =>
                              startDragAt(e, {
                                  // The cluster rect is always part of nsLayout,
                                  // so the store can diff the translation.
                                  onMove: (dx, dy) =>
                                      moveClusterRect({
                                          ...layout.cluster,
                                          x: layout.cluster.x + dx,
                                          y: layout.cluster.y + dy,
                                      }),
                                  onEnd: () => persistNodePositions(allTopLevelIds),
                              })
                        : undefined
                }
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
            >
                <div className="teaching-frame__title">Cluster</div>
                {framesEditable && (
                    <FrameHandles
                        onHandle={(dir, e) =>
                            startDragAt(e, {
                                onMove: (dx, dy) =>
                                    resizeClusterRect(resizeRect(layout.cluster, dx, dy, dir, NAMESPACE_MIN_RECT)),
                            })
                        }
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                    />
                )}
                {layout.nodes.map((nd) => (
                    <div
                        key={nd.name}
                        className={`teaching-frame teaching-frame--node${framesEditableClass}`}
                        style={{
                            width: nd.width,
                            height: nd.height,
                            transform: `translate(${nd.x - layout.cluster.x}px, ${nd.y - layout.cluster.y}px)`,
                        }}
                        onPointerDown={
                            framesEditable
                                ? (e) =>
                                      startDragAt(e, {
                                          onMove: (dx, dy) =>
                                              moveNodeRect(nd.name, {
                                                  ...nd,
                                                  x: nd.x + dx,
                                                  y: nd.y + dy,
                                              }),
                                          onEnd: () => persistNodePositions(nodeRideAlongNodeIds(nd)),
                                      })
                                : undefined
                        }
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                    >
                        <div className="teaching-frame__title">node: {nd.name}</div>
                        {framesEditable && (
                            <button
                                type="button"
                                className="teaching-frame__delete"
                                title={`Delete node “${nd.name}” (its namespaces stay on the cluster)`}
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteNode(nd.name);
                                }}
                            >
                                <span>Delete</span>
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    width="9"
                                    height="9"
                                >
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        )}
                        {framesEditable && (
                            <FrameHandles
                                onHandle={(dir, e) =>
                                    startDragAt(e, {
                                        onMove: (dx, dy) =>
                                            resizeNodeRect(nd.name, resizeRect(nd, dx, dy, dir, NODE_MIN_RECT)),
                                    })
                                }
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerEnd}
                                onPointerCancel={onPointerEnd}
                            />
                        )}
                    </div>
                ))}
                {layout.namespaces.map((ns) => {
                    const straddled = nodesOfNamespace(ns, layout.nodes);
                    const onNodes = straddled.length > 0 ? ` · on: ${straddled.map((nd) => nd.name).join(', ')}` : '';
                    return (
                    <div
                        key={ns.name}
                        className={`teaching-frame teaching-frame--inner${nsEditableClass}`}
                        style={{
                            width: ns.width,
                            height: ns.height,
                            transform: `translate(${ns.x - layout.cluster.x}px, ${ns.y - layout.cluster.y}px)`,
                        }}
                        onPointerDown={
                            nsEditMode
                                ? (e) =>
                                      startDragAt(e, {
                                          // The store diffs the passed rect against
                                          // its current layout (seeded from the
                                          // graph when never edited), so absolute
                                          // drag-start-anchored rects translate
                                          // contained nodes exactly once per move.
                                          onMove: (dx, dy) =>
                                              moveNamespace(ns.name, {
                                                  ...ns,
                                                  x: ns.x + dx,
                                                  y: ns.y + dy,
                                              }),
                                          onEnd: () =>
                                              persistNodePositions(namespaceNodeIds(ns.name)),
                                      })
                                : undefined
                        }
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                    >
                        <div className="teaching-frame__title">ns: {ns.name}{onNodes}</div>
                        {nsEditMode && !PROTECTED_NAMESPACES.has(ns.name) && (
                            <button
                                type="button"
                                className="teaching-frame__delete"
                                title={`Delete namespace “${ns.name}” and everything in it`}
                                onPointerDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteNamespace(ns.name);
                                }}
                            >
                                <span>Delete</span>
                                <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    width="9"
                                    height="9"
                                >
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        )}
                        {nsEditMode && (
                            <FrameHandles
                                onHandle={(dir, e) =>
                                    startDragAt(e, {
                                        onMove: (dx, dy) =>
                                            resizeNsRect(ns.name, resizeRect(ns, dx, dy, dir, NAMESPACE_MIN_RECT)),
                                    })
                                }
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerEnd}
                                onPointerCancel={onPointerEnd}
                            />
                        )}
                    </div>
                    );
                })}
            </div>
        </ViewportPortal>
    );
}

/** The 8 corner/edge resize grips, each dragging a different direction. */
function FrameHandles({
    onHandle,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    onHandle: (dir: ResizeDir, e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
}) {
    return (
        <>
            {RESIZE_HANDLES.map((dir) => (
                <div
                    key={dir}
                    className={`teaching-frame__resize-handle teaching-frame__resize-handle--${dir}`}
                    onPointerDown={(e) => onHandle(dir, e)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                />
            ))}
        </>
    );
}

/** New rectangle for a corner/edge drag starting from `start`. */
function resizeRect(start: Rect, dx: number, dy: number, dir: ResizeDir, minSize: number): Rect {
    let { x, y, width, height } = start;
    if (dir.includes('e')) width = Math.max(minSize, start.width + dx);
    if (dir.includes('s')) height = Math.max(minSize, start.height + dy);
    if (dir.includes('w')) {
        width = Math.max(minSize, start.width - dx);
        x = start.x + (start.width - width);
    }
    if (dir.includes('n')) {
        height = Math.max(minSize, start.height - dy);
        y = start.y + (start.height - height);
    }
    return { x, y, width, height };
}
