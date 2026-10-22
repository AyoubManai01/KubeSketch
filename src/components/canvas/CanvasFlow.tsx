import {
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import NsFrame from "../NsFrame";
import type { SupportedKind } from "../../types/types";
import type { HpaReplicaOverride, K8sNodeData } from "../../utils/buildGraph";
import { useIdeTheme } from "../../utils/ideTheme";
import type { CanvasHandlers } from "./useCanvasHandlers";

interface Props {
  displayNodes: Node<K8sNodeData>[];
  edges: Edge[];
  nodeTypes: NodeTypes;
  handlers: CanvasHandlers;
  anyFrameEditMode: boolean;
  effectiveLayout: ReturnType<typeof import("./useCanvasModel").useCanvasModel>["effectiveLayout"];
  nodes: Node<K8sNodeData>[];
  onDeleteNamespace: (name: string) => void;
  notice: { id: number; tone: "success" | "error" | "info"; text: string } | null;
  isEmpty: boolean;
  hasStructureFrames: boolean;
  hpaOverrides: HpaReplicaOverride[];
  setSelectedResource: (r: { kind: SupportedKind; name: string } | null) => void;
  setNamespaceModalOpen: (open: boolean) => void;
  minZoom: number;
}

/** The React Flow canvas area: nodes/edges, bounding frames, legend, feedback
 *  toast, empty state and the HPA-priority status bar. */
export function CanvasFlow({
  displayNodes,
  edges,
  nodeTypes,
  handlers,
  anyFrameEditMode,
  effectiveLayout,
  nodes,
  onDeleteNamespace,
  notice,
  isEmpty,
  hasStructureFrames,
  hpaOverrides,
  setSelectedResource,
  setNamespaceModalOpen,
  minZoom,
}: Props) {
  const ideTheme = useIdeTheme();

  return (
    <div className="canvas-body">
      <div className="canvas-flow-host">
        <ReactFlow
          nodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ type: "bezier" }}
          onNodesChange={handlers.onNodesChange}
          onEdgesChange={handlers.onEdgesChange}
          onConnect={handlers.onConnect}
          onNodeClick={(_, node) => {
            setSelectedResource({
              kind: node.data.kind as SupportedKind,
              name: node.data.name as string,
            });
          }}
          onPaneClick={() => setSelectedResource(null)}
          onNodeDragStart={handlers.onNodeDragStart}
          onNodeDrag={handlers.onNodeDrag}
          onNodeDragStop={handlers.onNodeDragStop}
          onInit={handlers.onFlowInit}
          minZoom={minZoom}
          nodesDraggable
          nodesConnectable={!anyFrameEditMode}
          // Resources are fixed in frame editing mode (drags snap back), so edge auto-pan
          // would only shift the view mid-drag and mislead the drop target.
          autoPanOnNodeDrag={!anyFrameEditMode}
          selectionOnDrag={false}
          elevateEdgesOnSelect={false}
          proOptions={{ hideAttribution: true }}
        >
          {/* Cluster/namespace bounding frames: editable in namespace editing mode */}
          <NsFrame
            layout={effectiveLayout}
            nodes={nodes}
            onDeleteNamespace={onDeleteNamespace}
          />
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
                HorizontalPodAutoscaler scales
              </span>
              <span className="canvas-legend__item canvas-legend__item--vpa">
                VPA right-sizes
              </span>
              <span className="canvas-legend__item canvas-legend__item--cm">
                ConfigMap use
              </span>
              <span className="canvas-legend__item canvas-legend__item--pvc">
                PVC mount
              </span>
              <span className="canvas-legend__item canvas-legend__item--pv">
                PV bind
              </span>
              <span className="canvas-legend__item canvas-legend__item--sc">
                StorageClass bind
              </span>
              <span className="canvas-legend__item canvas-legend__item--secret">
                Secret use
              </span>
              <span className="canvas-legend__item canvas-legend__item--tls">
                Ingress TLS
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
            color={ideTheme === 'light' ? 'rgba(15, 23, 42, 0.16)' : 'rgba(136, 166, 205, 0.18)'}
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

        {isEmpty && !hasStructureFrames && (
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
              Start with your cluster layout: add a namespace to group your
              resources. Then add resources using the toolbar above or paste
              a YAML manifest in the editor.
            </p>
            <div className="canvas-empty-state__actions">
              <button
                type="button"
                className="canvas-button"
                onClick={() => setNamespaceModalOpen(true)}
              >
                + Add Namespace
              </button>
            </div>
          </div>
        )}

        {/* Persistent HPA-priority warnings: a HorizontalPodAutoscaler overrode a workload's
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
                  HorizontalPodAutoscaler {o.hpaName} has more priority, so{" "}
                  {o.kind} {o.name}{" "}
                  {o.viaDeployment
                    ? `(via Deployment ${o.viaDeployment}) `
                    : ""}
                  replicas forced {o.original} → {o.effective} ({o.reason}=
                  {o.bound}). Make sure that the HorizontalPodAutoscaler's
                  min/max replicas are set correctly.
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}