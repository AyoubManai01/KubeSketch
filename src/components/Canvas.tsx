import { type NodeTypes } from "@xyflow/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import "@xyflow/react/dist/style.css";

import { useVeltraStore } from "../store/store";
import { isClusterScoped } from "../utils/k8sScope";
import type { SupportedKind } from "../types/types";
import { useCanvasModel } from "./canvas/useCanvasModel";
import { useInspectorDraft } from "./canvas/useInspectorDraft";
import { useCanvasHandlers } from "./canvas/useCanvasHandlers";
import { CanvasToolbar } from "./canvas/CanvasToolbar";
import { CanvasFlow } from "./canvas/CanvasFlow";
import { Inspector } from "./canvas/inspector/Inspector";
import K8sNode from "./K8sNode";
import CreateResourceModal from "./CreateResourceModal";
import CreateGatewayApiModal from "./CreateGatewayApiModal";
import ConfigMapLinkModal from "./ConfigMapLinkModal";
import PvcLinkModal from "./PvcLinkModal";
import SecretLinkModal from "./SecretLinkModal";
import IngressTlsLinkModal from "./IngressTlsLinkModal";
import NamespaceModal from "./NamespaceModal";
import DeleteNamespaceModal from "./DeleteNamespaceModal";

const nodeTypes: NodeTypes = { k8sNode: K8sNode };
const MIN_ZOOM = 0.5 / 1.2 ** 3;

/**
 * React Flow canvas displaying K8s resource nodes.
 * Reads nodes/edges from the Zustand store, which is the single source of truth
 * for the model, the merged edge list, and the current selection.
 */
export default function Canvas() {
  const uid = useId().replace(/:/g, "");
  const namespaceListId = `veltra-ns-${uid}`;

  const nodes = useVeltraStore((s) => s.nodes);
  const edges = useVeltraStore((s) => s.edges);
  const deleteNodeFromCanvas = useVeltraStore((s) => s.deleteNodeFromCanvas);
  const selectedResource = useVeltraStore((s) => s.selectedResource);
  const setSelectedResource = useVeltraStore((s) => s.setSelectedResource);
  const notice = useVeltraStore((s) => s.notice);
  const setNotice = useVeltraStore((s) => s.setNotice);
  const hpaOverrides = useVeltraStore((s) => s.hpaOverrides);
  const nsLayout = useVeltraStore((s) => s.nsLayout);
  const nsEditMode = useVeltraStore((s) => s.nsEditMode);
  const deleteNamespace = useVeltraStore((s) => s.deleteNamespace);

  const [pendingKind, setPendingKind] = useState<SupportedKind | null>(null);
  const [gatewayApiModalOpen, setGatewayApiModalOpen] = useState(false);
  const [namespaceModalOpen, setNamespaceModalOpen] = useState(false);
  const [deleteNsTarget, setDeleteNsTarget] = useState<{
    name: string;
    count: number;
  } | null>(null);
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

  const isEmpty = nodes.length === 0;
  // Namespace editing mode is active: resources become fixed / connections
  // and edge auto-pan switch off while arranging frames.
  const anyFrameEditMode = nsEditMode;

  const model = useCanvasModel(nodes, edges, nsLayout, selectedResource);

  // Reset inspector scroll/preview when a different resource is selected
  useEffect(() => {
    const resetPreview = () => setYamlPreviewOpen(false);
    resetPreview();
    if (inspectorContentRef.current) {
      inspectorContentRef.current.scrollTop = 0;
    }
  }, [model.selectionKey, inspectorContentRef]);
  // In namespace editing mode cluster-scoped kinds (PV/StorageClass) are fixed.
  // The React Flow `selected` flag follows the store selection (single source
  // of truth), so the visual highlight also lands on nodes selected from the
  // file explorer.
  const displayNodes = useMemo(() => {
    const selKey = selectedResource
      ? `${selectedResource.kind}:${selectedResource.name}`
      : "";
    return nodes.map((n) => {
      const node =
        nsEditMode && isClusterScoped(n.data.kind)
          ? { ...n, draggable: false }
          : n;
      const selected =
        selKey !== "" && `${n.data.kind}:${n.data.name}` === selKey;
      return node.selected === selected ? node : { ...node, selected };
    });
  }, [nodes, nsEditMode, selectedResource]);

  const draft = useInspectorDraft(
    model.selectedNode,
    model.selectionKey,
    model.isManaged,
    model.pvcUsedBy,
    nodes,
  );

  const handlers = useCanvasHandlers({
    nodes,
    nsEditMode,
    effectiveLayout: model.effectiveLayout,
  });

  // Delete button on a namespace frame: empty boxes vanish right away; boxes
  // holding resources pause in a confirmation before the cascade.
  const onDeleteNamespace = (name: string) => {
    const count = nodes.filter(
      (n) =>
        !n.parentId &&
        !n.data.synthetic &&
        !isClusterScoped(n.data.kind) &&
        (n.data.namespace ?? "default") === name,
    ).length;
    if (count === 0) {
      deleteNamespace(name);
    } else {
      setDeleteNsTarget({ name, count });
    }
  };

  return (
    <div className="canvas-panel">
      <div className="panel-header">
        <span className="panel-header__accent" />
        <span className="panel-header__title">Resource Canvas</span>
      </div>

      {/* Quick Actions Toolbar */}
      <CanvasToolbar
        setPendingKind={setPendingKind}
        setGatewayApiModalOpen={setGatewayApiModalOpen}
        setNamespaceModalOpen={setNamespaceModalOpen}
      />

      <div className="canvas-wrapper">
        <CanvasFlow
          displayNodes={displayNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          handlers={handlers}
          anyFrameEditMode={anyFrameEditMode}
          effectiveLayout={model.effectiveLayout}
          nodes={nodes}
          onDeleteNamespace={onDeleteNamespace}
          notice={notice}
          isEmpty={isEmpty}
          hasStructureFrames={model.hasStructureFrames}
          hpaOverrides={hpaOverrides}
          setSelectedResource={setSelectedResource}
          setNamespaceModalOpen={setNamespaceModalOpen}
          minZoom={MIN_ZOOM}
        />

        {/* â”€â”€â”€ Resource Inspector â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <Inspector
          selectedNode={model.selectedNode}
          inspectorData={model.inspectorData}
          isManaged={model.isManaged}
          managedOwner={model.managedOwner}
          setSelectedResource={setSelectedResource}
          namespaceListId={namespaceListId}
          model={model}
          draft={draft}
          nodes={nodes}
          dirty={draft.dirty}
          handleValidate={draft.handleValidate}
          deleteNodeFromCanvas={deleteNodeFromCanvas}
          yamlPreviewOpen={yamlPreviewOpen}
          setYamlPreviewOpen={setYamlPreviewOpen}
          inspectorContentRef={inspectorContentRef}
        />
      </div>

      {/* Creation modal: rendered outside the canvas flow */}
      {pendingKind && (
        <CreateResourceModal
          kind={pendingKind}
          onClose={() => setPendingKind(null)}
        />
      )}

      {/* Gateway API bundle creation modal */}
      {gatewayApiModalOpen && (
        <CreateGatewayApiModal onClose={() => setGatewayApiModalOpen(false)} />
      )}

      {/* Post-drag mechanism prompt for ConfigMap â†’ workload connections */}
      <ConfigMapLinkModal />

      {/* Post-drag volume-name prompt for PVC â†’ Pod connections */}
      <PvcLinkModal />

      {/* Post-drag mechanism prompt for Secret â†’ workload connections */}
      <SecretLinkModal />

      {/* Post-drag hosts prompt for Ingress â†’ Secret TLS connections */}
      <IngressTlsLinkModal />

      {/* New-namespace prompt (namespace editing mode) */}
      {namespaceModalOpen && (
        <NamespaceModal onClose={() => setNamespaceModalOpen(false)} />
      )}

      {/* Cascade-delete confirmation (non-empty namespace) */}
      {deleteNsTarget && (
        <DeleteNamespaceModal
          name={deleteNsTarget.name}
          count={deleteNsTarget.count}
          onCancel={() => setDeleteNsTarget(null)}
          onConfirm={() => {
            deleteNamespace(deleteNsTarget.name);
            setDeleteNsTarget(null);
          }}
        />
      )}
    </div>
  );
}
