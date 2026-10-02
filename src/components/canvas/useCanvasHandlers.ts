import { useCallback, useRef } from "react";
import {
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { K8sNodeData } from "../../utils/buildGraph";
import { isClusterScoped } from "../../utils/k8sScope";
import {
  clampPositionToRect,
  resolveNodeCollision,
  FALLBACK_NODE_WIDTH,
  FALLBACK_NODE_HEIGHT,
  type NsLayout,
} from "../../utils/teachingFrame";
import { useVeltraStore } from "../../store/store";
import { setRfInstance } from "../../utils/exportCanvas";
import { flowPointFromScreen } from "./inspectorUtils";

export interface CanvasHandlers {
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onNodeDragStart: (
    _: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => void;
  onNodeDrag: (
    _: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => void;
  onNodeDragStop: (
    event: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => void;
  onFlowInit: (instance: ReactFlowInstance<Node<K8sNodeData>>) => void;
}

interface Params {
  nodes: Node<K8sNodeData>[];
  nsEditMode: boolean;
  effectiveLayout: NsLayout;
}

/**
 * All React Flow event handlers: node/edge change routing (invariant 3),
 * drag clamping in normal mode and the namespace reassignment logic in
 * namespace editing mode. Reads the fresh store state mid-gesture because
 * React batches re-renders and the render-scope nodes are one frame stale
 * during a drag.
 */
export function useCanvasHandlers({
  nodes,
  nsEditMode,
  effectiveLayout,
}: Params): CanvasHandlers {
  const setCanvasNodes = useVeltraStore((s) => s.setCanvasNodes);
  const setCanvasNodesPositionOnly = useVeltraStore(
    (s) => s.setCanvasNodesPositionOnly,
  );
  const persistNodePositions = useVeltraStore((s) => s.persistNodePositions);
  const addCanvasEdge = useVeltraStore((s) => s.addCanvasEdge);
  const applyCanvasEdgeChanges = useVeltraStore(
    (s) => s.applyCanvasEdgeChanges,
  );
  const updateNodeFromCanvas = useVeltraStore((s) => s.updateNodeFromCanvas);
  const setNotice = useVeltraStore((s) => s.setNotice);

  // Skip YAML serialization for position/select/dimension-only changes (perf optimization)
  const onNodesChange = (changes: NodeChange[]) => {
    const hasResourceChanges = changes.some(
      (c) =>
        c.type !== "select" && c.type !== "position" && c.type !== "dimensions",
    );
    const nextNodes = applyNodeChanges(changes, nodes) as Node<K8sNodeData>[];
    if (hasResourceChanges) {
      setCanvasNodes(nextNodes);
    } else {
      setCanvasNodesPositionOnly(nextNodes);
    }
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    applyCanvasEdgeChanges(changes);
  };

  const onConnect = (connection: Connection) => {
    addCanvasEdge(connection);
  };

  // In namespace editing mode a resource drag is a namespace *reassignment*
  // attempt, not a move: resources are fixed in place and move only with their
  // rectangle. The pre-drag positions let us snap everything back on drop.
  const dragOriginRef = useRef<Map<string, { x: number; y: number }>>(
    new Map(),
  );
  // The cluster/namespace rectangles captured at drag start. Auto-derived
  // layouts re-hug the live nodes every render, so clamping against the *live*
  // layout would let a dragged node drag its own boundary along. The captured
  // layout is a stable constraint for the whole gesture.
  const dragLayoutRef = useRef<NsLayout | null>(null);

  const onNodeDragStart = (
    _: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => {
    const moved = draggedNodes?.length ? draggedNodes : [node];
    moved.forEach((n) => dragOriginRef.current.set(n.id, { ...n.position }));
    dragLayoutRef.current = effectiveLayout;
  };

  // Constrain a node's position while dragging in normal mode: namespaced
  // resources never leave their namespace box, and cluster-scoped kinds
  // (PV/StorageClass) never enter one (they stay inside the cluster instead).
  const clampDraggedNode = (n: Node<K8sNodeData>, layout: NsLayout) => {
    const width =
      typeof n.style?.width === "number" ? n.style.width : FALLBACK_NODE_WIDTH;
    const height =
      typeof n.style?.height === "number"
        ? n.style.height
        : FALLBACK_NODE_HEIGHT;
    if (isClusterScoped(n.data.kind)) {
      return resolveNodeCollision(
        n.position.x,
        n.position.y,
        width,
        height,
        layout.cluster,
        [...layout.namespaces],
      );
    }
    const nsRect = layout.namespaces.find(
      (ns) => ns.name === (n.data.namespace ?? "default"),
    );
    return clampPositionToRect(
      n.position.x,
      n.position.y,
      width,
      height,
      nsRect ?? layout.cluster,
    );
  };

  const onNodeDrag = (
    _: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => {
    if (nsEditMode) return;
    const layout = dragLayoutRef.current;
    if (!layout) return;
    const moved = draggedNodes?.length ? draggedNodes : [node];
    // React Flow emits onNodesChange before onNodeDrag in the same event, and
    // re-renders are batched: the render-scope `nodes` is one frame behind, so
    // clamp against the fresh store state.
    const current = useVeltraStore.getState().nodes;
    const next = current.map((n) => {
      const m = moved.find((mn) => mn.id === n.id);
      if (!m || n.parentId) return n;
      const clamped = clampDraggedNode(n, layout);
      if (clamped.x === n.position.x && clamped.y === n.position.y) return n;
      return { ...n, position: clamped };
    });
    if (next.some((n, i) => n !== current[i])) {
      setCanvasNodesPositionOnly(next);
    }
  };

  // Dragging only moves nodes: positions are persisted once on drop and the
  // YAML is never rewritten for a layout change (positions are not part of YAML).
  // Only the dragged nodes are pinned so the rest keep auto-layout behavior.
  const onNodeDragStop = (
    event: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => {
    const moved = draggedNodes?.length ? draggedNodes : [node];
    if (!nsEditMode) {
      const layout = dragLayoutRef.current;
      dragLayoutRef.current = null;
      dragOriginRef.current.clear();
      // React Flow emits one last unclamped position change on drop, after the
      // final onNodeDrag: re-apply the constraint so the node doesn't jump out
      // of its box at the end of the gesture.
      if (layout) {
        const current = useVeltraStore.getState().nodes;
        const draggedIds = new Set(moved.map((mn) => mn.id));
        const nodeRect = (o: Node<K8sNodeData>) => ({
          x: o.position.x,
          y: o.position.y,
          width:
            typeof o.style?.width === "number"
              ? o.style.width
              : FALLBACK_NODE_WIDTH,
          height:
            typeof o.style?.height === "number"
              ? o.style.height
              : FALLBACK_NODE_HEIGHT,
        });
        // React Flow emits one last unclamped position change on drop, after the
        // final onNodeDrag: re-apply the constraint so the node doesn't jump out
        // of its box at the end of the gesture, then push the dropped node out of
        // any resource it overlaps (node-vs-node collision: a dropped node never
        // sits on top of another resource, matching the auto-placement rules).
        const resolved = current.map((n) => {
          const m = moved.find((mn) => mn.id === n.id);
          if (!m || n.parentId) return n;
          const clamped = clampDraggedNode(n, layout);
          const width =
            typeof n.style?.width === "number"
              ? n.style.width
              : FALLBACK_NODE_WIDTH;
          const height =
            typeof n.style?.height === "number"
              ? n.style.height
              : FALLBACK_NODE_HEIGHT;
          const blockers = current
            .filter(
              (o) => o.id !== n.id && !o.parentId && !draggedIds.has(o.id),
            )
            .map(nodeRect);
          let pos;
          if (isClusterScoped(n.data.kind)) {
            pos = resolveNodeCollision(
              clamped.x,
              clamped.y,
              width,
              height,
              layout.cluster,
              [...blockers, ...layout.namespaces],
            );
          } else {
            const nsRect = layout.namespaces.find(
              (ns) => ns.name === (n.data.namespace ?? "default"),
            );
            pos = resolveNodeCollision(
              clamped.x,
              clamped.y,
              width,
              height,
              nsRect ?? layout.cluster,
              blockers,
            );
          }
          if (pos.x === n.position.x && pos.y === n.position.y) return n;
          return { ...n, position: pos };
        });
        if (resolved.some((n, i) => n !== current[i])) {
          setCanvasNodesPositionOnly(resolved);
        }
      }
      persistNodePositions(moved.map((n) => n.id));
      return;
    }
    // Namespace editing: resources are fixed. Snap every dragged node back to
    // its pre-drag position, then interpret the drop as a reassignment attempt.
    // A node dropped in ANOTHER namespace is reassigned by the placement engine
    // (store `updateNodeFromCanvas`): it lands at a free spot inside the target
    // box, which grows when the resource doesn't fit. Same guarantees as
    // creation. The drop anchor is the POINTER position (in flow coordinates),
    // not the node center: large workloads dwarf their target rectangles, and
    // the user aims at the rectangle with the cursor, not the node's centroid.
    const origins = dragOriginRef.current;
    const pointer = flowPointFromScreen(
      event as { clientX?: number; clientY?: number },
    );
    // Use the layout captured at drag start: the live layout re-hugs the dragged
    // node mid-drag, which would make the node's own box follow the pointer and
    // the target lookup unreliable.
    const dropLayout = dragLayoutRef.current ?? effectiveLayout;
    // Auto-derived rectangles can overlap (a big workload's namespace box can
    // surround a smaller one): the drop target is the SMALLEST box containing
    // the pointer, i.e. the most specific namespace.
    const findDropTarget = (point: { x: number; y: number }) =>
      dropLayout.namespaces
        .filter((ns) => rectContainsLocal(ns, point))
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const reassignedIds: string[] = [];
    const storeNodes = useVeltraStore.getState().nodes;
    const nextNodes = storeNodes.map((n) => {
      const origin = origins.get(n.id);
      if (!origin) return n;
      // Synthetic nodes belong to their owner's namespace; cluster-scoped kinds
      // never have a namespace, so neither can be reassigned. Both snap back.
      if (n.data.synthetic || isClusterScoped(n.data.kind)) {
        return { ...n, position: origin };
      }
      const width =
        typeof n.style?.width === "number"
          ? n.style.width
          : FALLBACK_NODE_WIDTH;
      const height =
        typeof n.style?.height === "number"
          ? n.style.height
          : FALLBACK_NODE_HEIGHT;
      const center = {
        x: n.position.x + width / 2,
        y: n.position.y + height / 2,
      };
      const target = findDropTarget(pointer ?? center);
      const current = n.data.namespace ?? "default";
      if (target && target.name !== current) {
        reassignedIds.push(n.id);
      }
      return { ...n, position: origin };
    });
    dragOriginRef.current = new Map();
    setCanvasNodesPositionOnly(nextNodes);
    reassignedIds.forEach((id) => {
      const n = nextNodes.find((nn) => nn.id === id);
      if (!n) return;
      const target = findDropTarget(
        pointer ?? { x: n.position.x, y: n.position.y },
      );
      if (!target) return;
      const current = n.data.namespace ?? "default";
      if (target.name === current) return;
      // The store re-places the node inside the target namespace (fresh, overlap-
      // free, growing the box when needed): no pinning here, that placement is
      // deterministic across reloads (invariant 4).
      updateNodeFromCanvas(n.id, { namespace: target.name });
      setNotice({
        id: Date.now() + Math.random(),
        tone: "success",
        text: `Moved ${n.data.name} to namespace “${target.name}”.`,
      });
    });
    dragLayoutRef.current = null;
  };

  const onFlowInit = useCallback(
    (instance: ReactFlowInstance<Node<K8sNodeData>>) => {
      setRfInstance(instance);
      if (nodes.length > 0) {
        void instance.fitView({ padding: 0.35, maxZoom: 0.95 });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  return {
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeDragStart,
    onNodeDrag,
    onNodeDragStop,
    onFlowInit,
  };
}

/** Point-in-rect test (same predicate teachingFrame uses for drop targets). */
function rectContainsLocal(
  rect: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}