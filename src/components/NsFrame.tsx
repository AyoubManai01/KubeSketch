import { useRef } from 'react';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import { useVeltraStore } from '../store/store';
import { isClusterScoped } from '../utils/k8sScope';
import { NAMESPACE_MIN_RECT, type NsLayout, type Rect } from '../utils/teachingFrame';
import type { K8sNodeData } from '../utils/buildGraph';
import type { PointerEvent as ReactPointerEvent } from 'react';

const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeDir = (typeof RESIZE_HANDLES)[number];

interface NsFrameProps {
    /** Effective (persisted + auto-discovered) cluster/namespace rectangles. */
    layout: NsLayout | null;
    nodes: Node<K8sNodeData>[];
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
 * The Cluster + namespace bounding rectangles. Decorative in normal mode
 * (pointer-events none, auto-derived bounds); in namespace editing mode they
 * become draggable/resizeable surfaces:
 * - dragging a namespace rectangle translates its contained top-level nodes,
 * - dragging the cluster rectangle translates everything,
 * - 8 resize handles shrink/expand either rectangle (nodes never move).
 */
export default function NsFrame({ layout, nodes }: NsFrameProps) {
    const nsEditMode = useVeltraStore((s) => s.nsEditMode);
    const moveNamespace = useVeltraStore((s) => s.moveNamespace);
    const moveClusterRect = useVeltraStore((s) => s.moveClusterRect);
    const resizeNsRect = useVeltraStore((s) => s.resizeNsRect);
    const resizeClusterRect = useVeltraStore((s) => s.resizeClusterRect);
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

    const startDragAt = (e: ReactPointerEvent<HTMLElement>, opts: DragOptions) => {
        if (!nsEditMode) return;
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

    const editableClass = nsEditMode ? ' teaching-frame--editable' : '';

    return (
        <ViewportPortal>
            <div
                className={`teaching-frame teaching-frame--outer${editableClass}`}
                style={{
                    width: layout.cluster.width,
                    height: layout.cluster.height,
                    transform: `translate(${layout.cluster.x}px, ${layout.cluster.y}px)`,
                }}
                onPointerDown={
                    nsEditMode
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
                {nsEditMode && (
                    <FrameHandles
                        onHandle={(dir, e) =>
                            startDragAt(e, {
                                onMove: (dx, dy) =>
                                    resizeClusterRect(resizeRect(layout.cluster, dx, dy, dir)),
                            })
                        }
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                    />
                )}
                {layout.namespaces.map((ns) => (
                    <div
                        key={ns.name}
                        className={`teaching-frame teaching-frame--inner${editableClass}`}
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
                        <div className="teaching-frame__title">ns: {ns.name}</div>
                        {nsEditMode && (
                            <FrameHandles
                                onHandle={(dir, e) =>
                                    startDragAt(e, {
                                        onMove: (dx, dy) =>
                                            resizeNsRect(ns.name, resizeRect(ns, dx, dy, dir)),
                                    })
                                }
                                onPointerMove={onPointerMove}
                                onPointerUp={onPointerEnd}
                                onPointerCancel={onPointerEnd}
                            />
                        )}
                    </div>
                ))}
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
function resizeRect(start: Rect, dx: number, dy: number, dir: ResizeDir): Rect {
    let { x, y, width, height } = start;
    if (dir.includes('e')) width = Math.max(NAMESPACE_MIN_RECT, start.width + dx);
    if (dir.includes('s')) height = Math.max(NAMESPACE_MIN_RECT, start.height + dy);
    if (dir.includes('w')) {
        width = Math.max(NAMESPACE_MIN_RECT, start.width - dx);
        x = start.x + (start.width - width);
    }
    if (dir.includes('n')) {
        height = Math.max(NAMESPACE_MIN_RECT, start.height - dy);
        y = start.y + (start.height - height);
    }
    return { x, y, width, height };
}
