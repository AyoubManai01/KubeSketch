import {
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type NodeTypes,
  type NodeChange,
  type Node,
  Panel,
  ViewportPortal,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xyflow/react/dist/style.css";

import { useVeltraStore } from "../store/store";
import K8sNode from "./K8sNode";
import {
  SUPPORTED_KINDS,
  type K8sResource,
  type SupportedKind,
} from "../types/types";
import {
  getWorkloadPodLabels,
  getHpaTarget,
  type K8sNodeData,
} from "../utils/buildGraph";
import { resourcesToYaml } from "../utils/serializeYaml";
import CreateResourceModal from "./CreateResourceModal";

/** Register our custom node type so React Flow can render it */
const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};
const FALLBACK_NODE_WIDTH = 220;
const FALLBACK_NODE_HEIGHT = 130;
const DEFAULT_NAMESPACES = ["default", "kube-system", "kube-public"];
const SERVICE_TYPES = ["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"];

const KIND_COLORS: Record<string, string> = {
  Deployment: "#10b981",
  ReplicaSet: "#f97316",
  Pod: "#14b8a6",
  Service: "#3b82f6",
  Ingress: "#8b5cf6",
  HPA: "#f59e0b",
};

const KIND_ICONS: Record<string, React.ReactNode> = {
  Deployment: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="8" height="8" rx="1.5" />
      <rect x="14" y="2" width="8" height="8" rx="1.5" />
      <rect x="2" y="14" width="8" height="8" rx="1.5" />
      <path d="M6 10v4M10 6h4M14 18h4" strokeDasharray="2 2" />
    </svg>
  ),
  ReplicaSet: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="10" height="10" rx="2" />
      <rect x="11" y="11" width="10" height="10" rx="2" strokeDasharray="2 2" />
      <path d="M13 8h3v3" strokeDasharray="2 2" />
    </svg>
  ),
  Pod: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  Service: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 4h-4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2z" />
      <path d="M8 13H4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2v-3a2 2 0 00-2-2z" />
      <path d="M9 8v5M15 15v-5M12 5v14" strokeDasharray="2 2" />
    </svg>
  ),
  Ingress: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  ),
  HPA: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20V10M12 6V4" />
      <path d="M12 16l3-3-3-3-3 3 3 3z" />
      <path d="M5 6a7 7 0 0014 0" />
    </svg>
  ),
};

function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(59,130,246,${alpha})`;
  return `rgba(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)},${alpha})`;
}

/**
 * React Flow canvas displaying K8s resource nodes.
 * Reads nodes/edges from the Zustand store — the store is the single source of truth
 * for the model, the merged edge list, and the current selection.
 */
export default function Canvas() {
  const uid = useId().replace(/:/g, "");
  const namespaceListId = `veltra-ns-${uid}`;

  const nodes = useVeltraStore((s) => s.nodes);
  const edges = useVeltraStore((s) => s.edges);
  const updateNodeFromCanvas = useVeltraStore((s) => s.updateNodeFromCanvas);
  const deleteNodeFromCanvas = useVeltraStore((s) => s.deleteNodeFromCanvas);
  const setCanvasNodes = useVeltraStore((s) => s.setCanvasNodes);
  const setCanvasNodesPositionOnly = useVeltraStore(
    (s) => s.setCanvasNodesPositionOnly,
  );
  const persistNodePositions = useVeltraStore((s) => s.persistNodePositions);
  const isBidirectionalSync = useVeltraStore((s) => s.isBidirectionalSync);
  const selectedResource = useVeltraStore((s) => s.selectedResource);
  const setSelectedResource = useVeltraStore((s) => s.setSelectedResource);
  const addCanvasEdge = useVeltraStore((s) => s.addCanvasEdge);
  const applyCanvasEdgeChanges = useVeltraStore(
    (s) => s.applyCanvasEdgeChanges,
  );
  const updateNodeResourceFromCanvas = useVeltraStore(
    (s) => s.updateNodeResourceFromCanvas,
  );
  const notice = useVeltraStore((s) => s.notice);
  const setNotice = useVeltraStore((s) => s.setNotice);
  const hpaOverrides = useVeltraStore((s) => s.hpaOverrides);

  const [pendingKind, setPendingKind] = useState<SupportedKind | null>(null);
  const [yamlPreviewOpen, setYamlPreviewOpen] = useState(false);
  const inspectorContentRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss the feedback toast (errors linger a bit longer)
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.tone === "error" ? 6000 : 4200,
    );
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  // Selection lives in the store as {kind, name} so it survives node ID changes
  // (renames, kind changes) — the node is looked up fresh on every render.
  const selectedNode = useMemo(() => {
    if (!selectedResource) return null;
    return (
      nodes.find(
        (n) =>
          n.data.kind === selectedResource.kind &&
          n.data.name === selectedResource.name,
      ) ?? null
    );
  }, [nodes, selectedResource]);

  // Reset inspector scroll/preview when a different resource is selected
  const selectionKey = selectedResource
    ? `${selectedResource.kind}:${selectedResource.name}`
    : "";
  useEffect(() => {
    setYamlPreviewOpen(false);
    if (inspectorContentRef.current) {
      inspectorContentRef.current.scrollTop = 0;
    }
  }, [selectionKey]);

  const isEmpty = nodes.length === 0;
  const teachingFrame = useMemo(() => buildTeachingFrame(nodes), [nodes]);

  const namespaceOptions = useMemo(() => {
    const discovered = new Set<string>(DEFAULT_NAMESPACES);
    nodes.forEach((node) => {
      if (node.data?.namespace) discovered.add(node.data.namespace);
    });
    return Array.from(discovered).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  // Selectable `app` label values, with the real resources they come from —
  // selector fields are dropdowns over the live model, never free text.
  const selectorOptions = useMemo(() => {
    const owners = new Map<string, string[]>();
    nodes.forEach((node) => {
      if (node.data.synthetic) return;
      const kind = node.data.kind;
      let value: string | undefined;
      if (kind === "Deployment" || kind === "ReplicaSet") {
        value = getWorkloadPodLabels(node.data.resource)?.app;
      } else if (kind === "Pod") {
        value = node.data.resource.metadata?.labels?.app;
      }
      if (!value) return;
      const list = owners.get(value) ?? [];
      list.push(`${kind} ${node.data.name}`);
      owners.set(value, list);
    });
    return Array.from(owners.entries())
      .map(([value, list]) => ({ value, owners: list.join(", ") }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [nodes]);

  const serviceOptions = useMemo(
    () =>
      nodes
        .filter((node) => node.data.kind === "Service")
        .map((node) => node.data.name as string)
        .sort((a, b) => a.localeCompare(b)),
    [nodes],
  );

  // HPA scale targets: Deployments and ReplicaSets on the canvas
  const workloadOptions = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            node.data.kind === "Deployment" || node.data.kind === "ReplicaSet",
        )
        .map((node) => ({
          kind: node.data.kind as string,
          name: node.data.name as string,
        }))
        .sort((a, b) =>
          `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`),
        ),
    [nodes],
  );

  // When the selected workload is scaled by an HPA, replicas are clamped into
  // [minReplicas, maxReplicas] — surface that priority right at the input.
  const hpaConstraint = useMemo(() => {
    if (
      !selectedNode ||
      (selectedNode.data.kind !== "Deployment" &&
        selectedNode.data.kind !== "ReplicaSet")
    ) {
      return null;
    }
    const hpa = nodes.find(
      (n) =>
        n.data.kind === "HPA" &&
        getHpaTarget(n.data.resource)?.kind === selectedNode.data.kind &&
        getHpaTarget(n.data.resource)?.name === selectedNode.data.name,
    );
    if (!hpa) return null;
    const spec = hpa.data.resource.spec as
      | { minReplicas?: number; maxReplicas?: number }
      | undefined;
    return {
      name: hpa.data.name as string,
      min: spec?.minReplicas,
      max: spec?.maxReplicas,
    };
  }, [nodes, selectedNode]);

  // Edge relationships + containment (nesting) for the selected node
  const relationships = useMemo(() => {
    if (!selectedNode) return [];
    type Rel = {
      key: string;
      kind: SupportedKind;
      name: string;
      direction: "outgoing" | "incoming" | "owns" | "owned-by";
      label: string;
    };
    const rels: Rel[] = [];

    edges
      .filter(
        (e) => e.source === selectedNode.id || e.target === selectedNode.id,
      )
      .forEach((e) => {
        const isOutgoing = e.source === selectedNode.id;
        const otherId = isOutgoing ? e.target : e.source;
        const otherNode = nodes.find((n) => n.id === otherId);
        if (!otherNode) return;
        rels.push({
          key: `edge-${e.id}`,
          kind: otherNode.data.kind,
          name: otherNode.data.name,
          direction: isOutgoing ? "outgoing" : "incoming",
          label: (e.label as string) || "",
        });
      });

    const parent = selectedNode.parentId
      ? nodes.find((n) => n.id === selectedNode.parentId)
      : null;
    if (parent) {
      rels.push({
        key: `parent-${parent.id}`,
        kind: parent.data.kind,
        name: parent.data.name,
        direction: "owned-by",
        label: "owner",
      });
    }
    nodes
      .filter((n) => n.parentId === selectedNode.id)
      .forEach((child) => {
        rels.push({
          key: `child-${child.id}`,
          kind: child.data.kind,
          name: child.data.name,
          direction: "owns",
          label: "owns",
        });
      });

    return rels;
  }, [edges, selectedNode, nodes]);

  // YAML preview for the selected resource
  const resourceYaml = useMemo(() => {
    if (!selectedNode) return "";
    try {
      return resourcesToYaml([selectedNode.data.resource]);
    } catch {
      return "";
    }
  }, [selectedNode]);

  // Inspector hero data
  const inspectorData = useMemo(() => {
    if (!selectedNode) return null;
    const kind = selectedNode.data.kind as string;
    return {
      kind,
      name: selectedNode.data.name as string,
      namespace: selectedNode.data.namespace as string | undefined,
      apiVersion: (selectedNode.data.resource as K8sResource)?.apiVersion ?? "",
      color: KIND_COLORS[kind] ?? "#8b949e",
      icon: KIND_ICONS[kind] ?? KIND_ICONS.Pod,
    };
  }, [selectedNode]);

  // Controller-managed (synthetic) resources are inspectable but not editable —
  // like a real cluster, their spec lives on the owning controller.
  const isManaged = !!selectedNode?.data.synthetic;
  const managedOwner = selectedNode?.data.managedBy ?? null;

  /** Empty string = valid; otherwise the validation error to show. */
  const validateName = useCallback(
    (kind: SupportedKind, candidate: string): string => {
      const trimmed = candidate.trim();
      if (!trimmed) return "Name is required.";
      const clash = nodes.some(
        (n) =>
          n.id !== selectedNode?.id &&
          n.data.kind === kind &&
          n.data.name === trimmed,
      );
      if (clash) return `A ${kind} named “${trimmed}” already exists.`;
      return "";
    },
    [nodes, selectedNode],
  );

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

  // Dragging only moves nodes — positions are persisted once on drop and the
  // YAML is never rewritten for a layout change (positions are not part of YAML).
  // Only the dragged nodes are pinned so the rest keep auto-layout behavior.
  const onNodeDragStop = (
    _: unknown,
    node: Node<K8sNodeData>,
    draggedNodes: Node<K8sNodeData>[],
  ) => {
    const moved = draggedNodes?.length ? draggedNodes : [node];
    persistNodePositions(moved.map((n) => n.id));
  };

  const onFlowInit = useCallback(
    (instance: ReactFlowInstance<Node<K8sNodeData>>) => {
      if (nodes.length > 0) {
        void instance.fitView({ padding: 0.35, maxZoom: 0.95 });
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  return (
    <div className="canvas-panel">
      <div className="panel-header">
        <span className="panel-header__accent" />
        <span className="panel-header__title">Resource Canvas</span>
      </div>

      {/* Quick Actions Toolbar */}
      <div className="canvas-toolbar">
        <div className="canvas-toolbar__group">
          {SUPPORTED_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="canvas-button"
              onClick={() => setPendingKind(kind)}
              title={`Add ${kind} resource`}
            >
              + {kind}
            </button>
          ))}
        </div>
        <span className="canvas-toolbar__hint">
          <span
            className={`canvas-sync-dot canvas-sync-dot--${isBidirectionalSync ? "active" : "inactive"}`}
          />
          {isBidirectionalSync ? "Sync active" : "Sync paused"}
        </span>
      </div>

      <div className="canvas-wrapper">
        <div className="canvas-body">
          <div className="canvas-flow-host">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={{ type: "bezier" }}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                setSelectedResource({
                  kind: node.data.kind as SupportedKind,
                  name: node.data.name as string,
                });
              }}
              onPaneClick={() => setSelectedResource(null)}
              onNodeDragStop={onNodeDragStop}
              onInit={onFlowInit}
              nodesDraggable
              selectionOnDrag={false}
              elevateEdgesOnSelect={false}
              proOptions={{ hideAttribution: true }}
            >
              <ViewportPortal>
                {teachingFrame && (
                  <div
                    className="teaching-frame teaching-frame--outer"
                    style={{
                      width: teachingFrame.width,
                      height: teachingFrame.height,
                      transform: `translate(${teachingFrame.x}px, ${teachingFrame.y}px)`,
                    }}
                  >
                    <div className="teaching-frame__title">Cluster</div>
                  </div>
                )}
                {teachingFrame?.namespaces.map((namespace) => (
                  <div
                    key={namespace.id}
                    className="teaching-frame teaching-frame--inner"
                    style={{
                      width: namespace.width,
                      height: namespace.height,
                      transform: `translate(${namespace.x}px, ${namespace.y}px)`,
                    }}
                  >
                    <div className="teaching-frame__title">
                      ns: {namespace.title}
                    </div>
                  </div>
                ))}
              </ViewportPortal>
              <Panel position="top-left">
                <div className="canvas-legend">
                  <span className="canvas-legend__item canvas-legend__item--own">
                    Ownership = nesting
                  </span>
                  <span className="canvas-legend__item canvas-legend__item--svc">
                    Service traffic
                  </span>
                  <span className="canvas-legend__item canvas-legend__item--ing">
                    Ingress route
                  </span>
                  <span className="canvas-legend__item canvas-legend__item--hpa">
                    HPA scales
                  </span>
                  <span className="canvas-legend__item canvas-legend__item--auto">
                    auto = managed by controller
                  </span>
                </div>
              </Panel>
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="rgba(136, 166, 205, 0.18)"
              />
              <Controls showInteractive={false} className="canvas-controls" />
            </ReactFlow>

            {/* Transient feedback: link results, validation errors, managed-resource guard rails */}
            {notice && (
              <div
                key={notice.id}
                className={`canvas-toast canvas-toast--${notice.tone}`}
                role="status"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  {notice.tone === "success" && <path d="M20 6L9 17l-5-5" />}
                  {notice.tone === "error" && (
                    <path d="M12 8v5M12 16.5h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
                  )}
                  {notice.tone === "info" && (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </>
                  )}
                </svg>
                <span>{notice.text}</span>
              </div>
            )}

            {isEmpty && (
              <div className="canvas-empty-state">
                <div className="canvas-empty-state__illustration">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                </div>
                <h3 className="canvas-empty-state__title">
                  Empty Infrastructure Canvas
                </h3>
                <p className="canvas-empty-state__desc">
                  No Kubernetes resources to visualize. Add resources using the
                  toolbar above or paste a YAML manifest in the editor.
                </p>
                <div className="canvas-empty-state__actions">
                  <button
                    type="button"
                    className="canvas-button"
                    onClick={() => setPendingKind("Deployment")}
                  >
                    + Add Deployment
                  </button>
                  <button
                    type="button"
                    className="canvas-button"
                    onClick={() => setPendingKind("Service")}
                  >
                    + Add Service
                  </button>
                </div>
              </div>
            )}

            {/* Persistent HPA-priority warnings: an HPA overrode a workload's
                spec.replicas this commit (clamped into [minReplicas, maxReplicas]). */}
            {hpaOverrides.length > 0 && (
              <div className="canvas-statusbar" role="status">
                {hpaOverrides.map((o) => (
                  <div
                    key={`${o.kind}:${o.name}`}
                    className="canvas-statusbar__item"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M3 3v18h18" />
                      <path d="M7 14l4-4 3 3 5-6" />
                    </svg>
                    <span>
                      HPA {o.hpaName} has more priority — {o.kind} {o.name}{" "}
                      {o.viaDeployment
                        ? `(via Deployment ${o.viaDeployment}) `
                        : ""}
                      replicas forced {o.original} → {o.effective} ({o.reason}=
                      {o.bound}). Make sure that the HPA's min/max replicas are
                      set correctly.
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── Resource Inspector ────────────────────────────────── */}
          <aside
            className={`node-inspector ${selectedNode ? "node-inspector--open" : ""}`}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => e.stopPropagation()}
            onWheelCapture={(e) => e.stopPropagation()}
          >
            {/* Inspector header */}
            <div className="node-inspector__header">
              <span className="node-inspector__title">Inspector</span>
              {selectedNode && (
                <button
                  type="button"
                  className="node-inspector__close"
                  onClick={() => setSelectedResource(null)}
                  title="Close Inspector"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Empty state */}
            {!selectedNode && (
              <div className="node-inspector__empty">
                <svg
                  className="node-inspector__empty-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                Select a resource on the canvas to inspect and edit its
                properties.
              </div>
            )}

            {/* Inspector content */}
            {selectedNode && inspectorData && (
              <div className="inspector-content" ref={inspectorContentRef}>
                {/* ── Hero Header ─────────────────────────── */}
                <div
                  className="inspector-hero"
                  style={
                    {
                      "--kind-color": inspectorData.color,
                    } as React.CSSProperties
                  }
                >
                  <div
                    className="inspector-hero__icon-wrap"
                    style={{
                      backgroundColor: hexToRgba(inspectorData.color, 0.12),
                      borderColor: hexToRgba(inspectorData.color, 0.28),
                      color: inspectorData.color,
                    }}
                  >
                    {inspectorData.icon}
                  </div>
                  <div className="inspector-hero__info">
                    <div className="inspector-hero__badges">
                      <span
                        className="inspector-hero__kind-badge"
                        style={{
                          backgroundColor: hexToRgba(inspectorData.color, 0.15),
                          color: inspectorData.color,
                          borderColor: hexToRgba(inspectorData.color, 0.3),
                        }}
                      >
                        {inspectorData.kind}
                      </span>
                      {inspectorData.apiVersion && (
                        <span className="inspector-hero__api-badge">
                          {inspectorData.apiVersion}
                        </span>
                      )}
                    </div>
                    <div
                      className="inspector-hero__name"
                      title={inspectorData.name}
                    >
                      {inspectorData.name}
                    </div>
                    {inspectorData.namespace && (
                      <div className="inspector-hero__namespace">
                        ns/{inspectorData.namespace}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Managed-resource banner ─────────────── */}
                {isManaged && managedOwner && (
                  <div className="inspector-managed-banner">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                    </svg>
                    <div className="inspector-managed-banner__text">
                      <strong>
                        Managed by {managedOwner.kind} {managedOwner.name}
                      </strong>
                      <p>
                        Kubernetes creates this {inspectorData.kind}{" "}
                        automatically — it is not part of the manifest. Edit the
                        owner to change it; scale its replicas to change the Pod
                        count.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="inspector-managed-banner__btn"
                      onClick={() =>
                        setSelectedResource({
                          kind: managedOwner.kind,
                          name: managedOwner.name,
                        })
                      }
                    >
                      Inspect {managedOwner.kind}
                    </button>
                  </div>
                )}

                {/* ── Managed-resource read-only details ──── */}
                {isManaged && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                      </svg>
                      Details
                    </div>
                    <div className="inspector-section__body">
                      {(() => {
                        const spec = (selectedNode.data.resource.spec ??
                          {}) as Record<string, any>;
                        const labels =
                          selectedNode.data.resource.metadata?.labels ?? {};
                        const rows: Array<{ k: string; v: string }> = [];
                        if (inspectorData.namespace)
                          rows.push({
                            k: "Namespace",
                            v: inspectorData.namespace,
                          });
                        if (
                          inspectorData.kind === "ReplicaSet" &&
                          typeof spec.replicas === "number"
                        ) {
                          rows.push({
                            k: "Replicas",
                            v: String(spec.replicas),
                          });
                        }
                        if (spec.containers?.[0]?.name)
                          rows.push({
                            k: "Container",
                            v: spec.containers[0].name,
                          });
                        if (spec.containers?.[0]?.image)
                          rows.push({
                            k: "Image",
                            v: spec.containers[0].image,
                          });
                        return (
                          <>
                            {rows.map((row) => (
                              <div key={row.k} className="inspector-static-row">
                                <span className="inspector-static-row__key">
                                  {row.k}
                                </span>
                                <span
                                  className="inspector-static-row__val"
                                  title={row.v}
                                >
                                  {row.v}
                                </span>
                              </div>
                            ))}
                            {Object.keys(labels).length > 0 && (
                              <div className="inspector-label-chips">
                                {Object.entries(labels).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="inspector-label-chip"
                                  >
                                    {k}={v}
                                  </span>
                                ))}
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* ── Section: General ────────────────────── */}
                {!isManaged && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="8" r="4" />
                        <path d="M6 20v-2a6 6 0 0112 0v2" />
                      </svg>
                      General
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Resource Type
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={inspectorData.kind}
                          onChange={(e) =>
                            updateNodeFromCanvas(selectedNode.id, {
                              kind: e.target.value as SupportedKind,
                            })
                          }
                        >
                          {SUPPORTED_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </div>
                      <NameField
                        value={inspectorData.name}
                        resetToken={selectionKey}
                        validate={(candidate) =>
                          validateName(
                            selectedNode.data.kind as SupportedKind,
                            candidate,
                          )
                        }
                        onCommit={(name) =>
                          updateNodeFromCanvas(selectedNode.id, { name })
                        }
                      />
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Namespace
                        </label>
                        <input
                          className="inspector-field__input"
                          value={inspectorData.namespace ?? ""}
                          list={namespaceListId}
                          onChange={(e) =>
                            updateNodeFromCanvas(selectedNode.id, {
                              namespace: e.target.value,
                            })
                          }
                          placeholder="default"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Metadata ───────────────────── */}
                {!isManaged && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                        <line x1="7" y1="7" x2="7.01" y2="7" />
                      </svg>
                      Metadata
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">Labels</label>
                        <input
                          className="inspector-field__input"
                          value={toKeyValueString(
                            selectedNode.data.resource.metadata?.labels,
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                metadata: {
                                  ...selectedNode.data.resource.metadata,
                                  labels: parseKeyValueString(e.target.value),
                                },
                              },
                            )
                          }
                          placeholder="app=my-app,tier=frontend"
                        />
                        {selectedNode.data.resource.metadata?.labels &&
                          Object.keys(
                            selectedNode.data.resource.metadata.labels,
                          ).length > 0 && (
                            <div className="inspector-label-chips">
                              {Object.entries(
                                selectedNode.data.resource.metadata.labels,
                              ).map(([k, v]) => (
                                <span key={k} className="inspector-label-chip">
                                  {k}={v}
                                </span>
                              ))}
                            </div>
                          )}
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Annotations
                        </label>
                        <input
                          className="inspector-field__input"
                          value={toKeyValueString(
                            selectedNode.data.resource.metadata?.annotations as
                              | Record<string, string>
                              | undefined,
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                metadata: {
                                  ...selectedNode.data.resource.metadata,
                                  annotations: parseKeyValueString(
                                    e.target.value,
                                  ),
                                },
                              },
                            )
                          }
                          placeholder="owner=team-a"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Scaling (Deployment / ReplicaSet) ── */}
                {!isManaged &&
                  (inspectorData.kind === "Deployment" ||
                    inspectorData.kind === "ReplicaSet") && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="20" x2="18" y2="10" />
                          <line x1="12" y1="20" x2="12" y2="4" />
                          <line x1="6" y1="20" x2="6" y2="14" />
                        </svg>
                        Scaling
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-field">
                          <label className="inspector-field__label">
                            Replicas
                          </label>
                          <input
                            className="inspector-field__input"
                            type="number"
                            min={0}
                            value={String(
                              (selectedNode.data.resource.spec as any)
                                ?.replicas ?? "",
                            )}
                            onChange={(e) =>
                              updateResourceField(
                                selectedNode.id,
                                selectedNode.data.resource,
                                updateNodeResourceFromCanvas,
                                {
                                  spec: {
                                    ...(selectedNode.data.resource.spec as any),
                                    replicas: toOptionalNumber(e.target.value),
                                  },
                                },
                              )
                            }
                            placeholder="3"
                          />
                          <span className="inspector-field__hint">
                            Pods are materialized on the canvas to match this
                            count, like a real cluster.
                          </span>
                          {hpaConstraint && (
                            <span className="inspector-field__hint inspector-field__hint--hpa">
                              HPA {hpaConstraint.name} has priority — replicas
                              are clamped to {hpaConstraint.min ?? 1}–
                              {hpaConstraint.max ?? "∞"} and written back to
                              YAML.
                            </span>
                          )}
                        </div>
                        <div className="inspector-field">
                          <label className="inspector-field__label">
                            Selector (app=)
                          </label>
                          {(() => {
                            const current =
                              ((selectedNode.data.resource.spec as any)
                                ?.selector?.matchLabels?.app as
                                | string
                                | undefined) ?? "";
                            const ownName = selectedNode.data.name as string;
                            const known = selectorOptions.some(
                              (o) => o.value === current,
                            );
                            return (
                              <select
                                className="inspector-field__input inspector-field__input--select"
                                value={current}
                                onChange={(e) =>
                                  updateResourceField(
                                    selectedNode.id,
                                    selectedNode.data.resource,
                                    updateNodeResourceFromCanvas,
                                    {
                                      spec: {
                                        ...(selectedNode.data.resource
                                          .spec as any),
                                        selector: e.target.value
                                          ? {
                                              ...((
                                                selectedNode.data.resource
                                                  .spec as any
                                              )?.selector ?? {}),
                                              matchLabels: {
                                                app: e.target.value,
                                              },
                                            }
                                          : undefined,
                                      },
                                    },
                                  )
                                }
                              >
                                <option value="">(no selector)</option>
                                {selectorOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.value} — {o.owners}
                                  </option>
                                ))}
                                {!selectorOptions.some(
                                  (o) => o.value === ownName,
                                ) &&
                                  current !== ownName && (
                                    <option value={ownName}>
                                      {ownName} (create new label)
                                    </option>
                                  )}
                                {current && !known && (
                                  <option value={current}>
                                    {current} (no match on canvas)
                                  </option>
                                )}
                              </select>
                            );
                          })()}
                          <span className="inspector-field__hint">
                            Pods/ReplicaSets carrying this app label are
                            rendered inside this workload.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                {/* ── Section: Containers (Pod) ───────────── */}
                {!isManaged && inspectorData.kind === "Pod" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="2" y="7" width="20" height="14" rx="2" />
                        <path d="M16 7V5a4 4 0 00-8 0v2" />
                      </svg>
                      Containers
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Container Name
                        </label>
                        <input
                          className="inspector-field__input"
                          value={
                            (selectedNode.data.resource.spec as any)
                              ?.containers?.[0]?.name ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  containers: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.containers?.[0] ?? {}),
                                      name: e.target.value,
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={
                            (selectedNode.data.resource.spec as any)
                              ?.containers?.[0]?.image ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  containers: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.containers?.[0] ?? {}),
                                      image: e.target.value,
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Networking (Service) ───────── */}
                {inspectorData.kind === "Service" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M3 12h12" />
                      </svg>
                      Networking
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Service Type
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={
                            (selectedNode.data.resource.spec as any)?.type ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  type: e.target.value || undefined,
                                },
                              },
                            )
                          }
                        >
                          <option value="">(default: ClusterIP)</option>
                          {SERVICE_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Route to (selector app=)
                        </label>
                        {(() => {
                          const current =
                            ((selectedNode.data.resource.spec as any)?.selector
                              ?.app as string | undefined) ?? "";
                          const known = selectorOptions.some(
                            (o) => o.value === current,
                          );
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                updateResourceField(
                                  selectedNode.id,
                                  selectedNode.data.resource,
                                  updateNodeResourceFromCanvas,
                                  {
                                    spec: {
                                      ...(selectedNode.data.resource
                                        .spec as any),
                                      selector: e.target.value
                                        ? { app: e.target.value }
                                        : undefined,
                                    },
                                  },
                                )
                              }
                            >
                              <option value="">(no selector)</option>
                              {selectorOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.value} — {o.owners}
                                </option>
                              ))}
                              {current && !known && (
                                <option value={current}>
                                  {current} (no match on canvas)
                                </option>
                              )}
                            </select>
                          );
                        })()}
                        <span className="inspector-field__hint">
                          Lists the workloads and Pods that currently exist on
                          the canvas.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Port</label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          value={String(
                            (selectedNode.data.resource.spec as any)?.ports?.[0]
                              ?.port ?? "",
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  ports: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.ports?.[0] ?? {}),
                                      port: toOptionalNumber(e.target.value),
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="80"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Target Port
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            (selectedNode.data.resource.spec as any)?.ports?.[0]
                              ?.targetPort ?? "",
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  ports: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.ports?.[0] ?? {}),
                                      targetPort:
                                        toOptionalNumber(e.target.value) ??
                                        (e.target.value || undefined),
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="8080"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Routing (Ingress) ──────────── */}
                {inspectorData.kind === "Ingress" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                      Routing
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">Host</label>
                        <input
                          className="inspector-field__input"
                          value={
                            (selectedNode.data.resource.spec as any)?.rules?.[0]
                              ?.host ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  rules: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.rules?.[0] ?? {}),
                                      host: e.target.value,
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="my-app.example.com"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Path</label>
                        <input
                          className="inspector-field__input"
                          value={
                            (selectedNode.data.resource.spec as any)?.rules?.[0]
                              ?.http?.paths?.[0]?.path ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  rules: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.rules?.[0] ?? {}),
                                      http: {
                                        ...((
                                          selectedNode.data.resource.spec as any
                                        )?.rules?.[0]?.http ?? {}),
                                        paths: [
                                          {
                                            ...((
                                              selectedNode.data.resource
                                                .spec as any
                                            )?.rules?.[0]?.http?.paths?.[0] ??
                                              {}),
                                            path: e.target.value,
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="/"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Backend Service
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={
                            ((selectedNode.data.resource.spec as any)
                              ?.rules?.[0]?.http?.paths?.[0]?.backend?.service
                              ?.name as string | undefined) ?? ""
                          }
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  rules: [
                                    {
                                      ...((
                                        selectedNode.data.resource.spec as any
                                      )?.rules?.[0] ?? {}),
                                      http: {
                                        ...((
                                          selectedNode.data.resource.spec as any
                                        )?.rules?.[0]?.http ?? {}),
                                        paths: [
                                          {
                                            ...((
                                              selectedNode.data.resource
                                                .spec as any
                                            )?.rules?.[0]?.http?.paths?.[0] ??
                                              {}),
                                            backend: e.target.value
                                              ? {
                                                  service: {
                                                    name: e.target.value,
                                                    port: {
                                                      number: Number(
                                                        (
                                                          selectedNode.data
                                                            .resource
                                                            .spec as any
                                                        )?.rules?.[0]?.http
                                                          ?.paths?.[0]?.backend
                                                          ?.service?.port
                                                          ?.number ?? 80,
                                                      ),
                                                    },
                                                  },
                                                }
                                              : undefined,
                                          },
                                        ],
                                      },
                                    },
                                  ],
                                },
                              },
                            )
                          }
                        >
                          <option value="">(no backend)</option>
                          {serviceOptions.map((svc) => (
                            <option key={svc} value={svc}>
                              {svc}
                            </option>
                          ))}
                          {(() => {
                            const current =
                              ((selectedNode.data.resource.spec as any)
                                ?.rules?.[0]?.http?.paths?.[0]?.backend?.service
                                ?.name as string | undefined) ?? "";
                            return current &&
                              !serviceOptions.includes(current) ? (
                              <option value={current}>
                                {current} (missing)
                              </option>
                            ) : null;
                          })()}
                        </select>
                        <span className="inspector-field__hint">
                          Lists the Services that currently exist on the canvas.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Autoscaling (HPA) ─────────── */}
                {!isManaged && inspectorData.kind === "HPA" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <line x1="18" y1="20" x2="18" y2="10" />
                        <line x1="12" y1="20" x2="12" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="14" />
                      </svg>
                      Autoscaling
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Scale Target
                        </label>
                        {(() => {
                          const ref = (selectedNode.data.resource.spec as any)
                            ?.scaleTargetRef as
                            | { kind?: string; name?: string }
                            | undefined;
                          const current =
                            ref?.kind && ref.name
                              ? `${ref.kind}|${ref.name}`
                              : "";
                          const known = workloadOptions.some(
                            (w) => `${w.kind}|${w.name}` === current,
                          );
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                updateResourceField(
                                  selectedNode.id,
                                  selectedNode.data.resource,
                                  updateNodeResourceFromCanvas,
                                  {
                                    spec: {
                                      ...(selectedNode.data.resource
                                        .spec as any),
                                      scaleTargetRef: e.target.value
                                        ? {
                                            apiVersion: "apps/v1",
                                            kind: e.target.value.split("|")[0],
                                            name: e.target.value.split("|")[1],
                                          }
                                        : undefined,
                                    },
                                  },
                                )
                              }
                            >
                              <option value="">(no target)</option>
                              {workloadOptions.map((w) => (
                                <option
                                  key={`${w.kind}|${w.name}`}
                                  value={`${w.kind}|${w.name}`}
                                >
                                  {w.kind} {w.name}
                                </option>
                              ))}
                              {current && !known && (
                                <option value={current}>
                                  {ref?.kind} {ref?.name} (missing)
                                </option>
                              )}
                            </select>
                          );
                        })()}
                        <span className="inspector-field__hint">
                          Lists the Deployments and ReplicaSets currently on the
                          canvas.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Min Replicas
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            (selectedNode.data.resource.spec as any)
                              ?.minReplicas ?? "",
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  minReplicas: toOptionalNumber(e.target.value),
                                },
                              },
                            )
                          }
                          placeholder="1"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Max Replicas
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            (selectedNode.data.resource.spec as any)
                              ?.maxReplicas ?? "",
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  maxReplicas: toOptionalNumber(e.target.value),
                                },
                              },
                            )
                          }
                          placeholder="10"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          CPU Target %
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          max={100}
                          value={String(
                            (selectedNode.data.resource.spec as any)
                              ?.metrics?.[0]?.resource?.target
                              ?.averageUtilization ?? "",
                          )}
                          onChange={(e) =>
                            updateResourceField(
                              selectedNode.id,
                              selectedNode.data.resource,
                              updateNodeResourceFromCanvas,
                              {
                                spec: {
                                  ...(selectedNode.data.resource.spec as any),
                                  metrics: [
                                    {
                                      type: "Resource",
                                      resource: {
                                        name: "cpu",
                                        target: {
                                          type: "Utilization",
                                          averageUtilization: toOptionalNumber(
                                            e.target.value,
                                          ),
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            )
                          }
                          placeholder="70"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Relationships ───────────────── */}
                {relationships.length > 0 && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      Relationships
                      <span className="inspector-section__count">
                        {relationships.length}
                      </span>
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-rel-list">
                        {relationships.map((rel) => (
                          <button
                            key={rel.key}
                            type="button"
                            className="inspector-rel-item inspector-rel-item--link"
                            title={`Select ${rel.kind} ${rel.name}`}
                            onClick={() =>
                              setSelectedResource({
                                kind: rel.kind,
                                name: rel.name,
                              })
                            }
                          >
                            <span
                              className={`inspector-rel-arrow inspector-rel-arrow--${rel.direction}`}
                              title={rel.direction}
                            >
                              {rel.direction === "outgoing" && "↓"}
                              {rel.direction === "incoming" && "↑"}
                              {rel.direction === "owns" && "▣"}
                              {rel.direction === "owned-by" && "◈"}
                            </span>
                            <div className="inspector-rel-info">
                              <span className="inspector-rel-kind">
                                {rel.kind}
                              </span>
                              <span className="inspector-rel-name">
                                {rel.name}
                              </span>
                            </div>
                            {rel.label && (
                              <span className="inspector-rel-badge">
                                {rel.label}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: YAML Preview ────────────────── */}
                <div className="inspector-section">
                  <button
                    type="button"
                    className="inspector-section__header inspector-section__header--toggle"
                    onClick={() => setYamlPreviewOpen((o) => !o)}
                  >
                    <span className="inspector-section__header-inner">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="16 18 22 12 16 6" />
                        <polyline points="8 6 2 12 8 18" />
                      </svg>
                      YAML Preview
                    </span>
                    <svg
                      className={`inspector-chevron ${yamlPreviewOpen ? "inspector-chevron--open" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {yamlPreviewOpen && resourceYaml && (
                    <>
                      <pre className="inspector-yaml-preview">
                        {resourceYaml}
                      </pre>
                      {isManaged && (
                        <span className="inspector-field__hint inspector-field__hint--pad">
                          Effective state generated by the controller — not part
                          of the manifest.
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* ── Footer: Delete ───────────────────────── */}
                {isManaged ? (
                  <div className="inspector-footer">
                    <span className="inspector-footer__hint">
                      Managed resources can't be deleted directly — Kubernetes
                      would recreate them. Delete the owner or lower its
                      replicas.
                    </span>
                  </div>
                ) : (
                  <div className="inspector-footer">
                    <button
                      type="button"
                      className="inspector-delete-btn"
                      onClick={() => deleteNodeFromCanvas(selectedNode.id)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                      Delete Resource
                    </button>
                    {nodes.some((n) => n.parentId === selectedNode.id) && (
                      <span className="inspector-footer__hint">
                        Owned resources are deleted with it (K8s cascade).
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Datalists (always rendered when inspector open) */}
            {selectedNode && (
              <datalist id={namespaceListId}>
                {namespaceOptions.map((ns) => (
                  <option key={ns} value={ns} />
                ))}
              </datalist>
            )}
          </aside>
        </div>
      </div>

      {/* Creation modal — rendered outside the canvas flow */}
      {pendingKind && (
        <CreateResourceModal
          kind={pendingKind}
          onClose={() => setPendingKind(null)}
        />
      )}
    </div>
  );
}

// ─── Name field with validation ─────────────────────────────────────────────

/**
 * Controlled name editor with a local draft: invalid values (empty/duplicate)
 * show an inline error and are never committed to the model, while valid
 * keystrokes commit immediately so the canvas/YAML stay live.
 */
function NameField({
  value,
  resetToken,
  validate,
  onCommit,
}: {
  value: string;
  /** Changes whenever a different resource is selected — resets the draft. */
  resetToken: string;
  validate: (candidate: string) => string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const [lastToken, setLastToken] = useState(resetToken);

  // Selection switched to another resource — adopt its name (render-time
  // adjustment; no remount, so typing focus is preserved during renames).
  if (lastToken !== resetToken) {
    setLastToken(resetToken);
    setDraft(value);
    setError("");
  }

  return (
    <div className="inspector-field">
      <label className="inspector-field__label">Name</label>
      <input
        className={`inspector-field__input ${error ? "inspector-field__input--invalid" : ""}`}
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const validationError = validate(next);
          setError(validationError);
          if (!validationError && next.trim() !== value) {
            onCommit(next.trim());
          }
        }}
        onBlur={() => {
          // Revert to the last committed name if the draft is invalid
          if (error) {
            setDraft(value);
            setError("");
          }
        }}
        placeholder="resource-name"
      />
      {error && <span className="inspector-field__error">{error}</span>}
    </div>
  );
}

// ─── Helper functions ───────────────────────────────────────────────────────

/**
 * Compute the Cluster/namespace guide frames from the *top-level* nodes only,
 * using each node's real width/height. Child nodes have parent-relative
 * coordinates and must not participate in absolute bounds.
 */
function buildTeachingFrame(nodes: Node<K8sNodeData>[]) {
  const topLevel = nodes.filter((n) => !n.parentId);
  if (!topLevel.length) return null;
  const outer = getNodeBounds(topLevel, 90, 110);
  const namespaceMap = new Map<string, Node<K8sNodeData>[]>();
  topLevel.forEach((node) => {
    const key = node.data?.namespace ?? "default";
    const list = namespaceMap.get(key) ?? [];
    list.push(node);
    namespaceMap.set(key, list);
  });

  const namespaces = Array.from(namespaceMap.entries()).map(
    ([namespace, members]) => {
      const bounds = getNodeBounds(members, 40, 46);
      return { id: `ns-${namespace}`, title: namespace, ...bounds };
    },
  );

  return { ...outer, namespaces };
}

function getNodeBounds(nodes: Node<K8sNodeData>[], xPad: number, yPad: number) {
  const bounds = nodes.reduce(
    (acc, node) => {
      const width =
        typeof node.style?.width === "number"
          ? node.style.width
          : FALLBACK_NODE_WIDTH;
      const height =
        typeof node.style?.height === "number"
          ? node.style.height
          : FALLBACK_NODE_HEIGHT;
      return {
        minX: Math.min(acc.minX, node.position.x),
        maxX: Math.max(acc.maxX, node.position.x + width),
        minY: Math.min(acc.minY, node.position.y),
        maxY: Math.max(acc.maxY, node.position.y + height),
      };
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
  return {
    x: bounds.minX - xPad,
    y: bounds.minY - yPad,
    width: bounds.maxX - bounds.minX + xPad * 2,
    height: bounds.maxY - bounds.minY + yPad * 2,
  };
}

function toOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseKeyValueString(
  value: string,
): Record<string, string> | undefined {
  if (!value.trim()) return undefined;
  const obj: Record<string, string> = {};
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [k, ...rest] = pair.split("=");
      if (!k || rest.length === 0) return;
      obj[k.trim()] = rest.join("=").trim();
    });
  return Object.keys(obj).length ? obj : undefined;
}

function toKeyValueString(value: Record<string, string> | undefined): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function updateResourceField(
  nodeId: string,
  resource: K8sResource,
  updateFn: (nodeId: string, resource: K8sResource) => void,
  patch: Partial<K8sResource>,
) {
  updateFn(nodeId, {
    ...resource,
    ...patch,
    metadata: {
      ...(resource.metadata ?? {}),
      ...(patch.metadata ?? {}),
    },
    spec: {
      ...(resource.spec as Record<string, unknown> | undefined),
      ...(patch.spec as Record<string, unknown> | undefined),
    },
  });
}
