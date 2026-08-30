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
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import "@xyflow/react/dist/style.css";

import { useVeltraStore, apiVersionForKind } from "../store/store";
import K8sNode from "./K8sNode";
import NsFrame from "./NsFrame";
import {
  SUPPORTED_KINDS,
  type K8sResource,
  type SupportedKind,
} from "../types/types";
import { isClusterScoped } from "../utils/k8sScope";
import {
  effectiveNsLayout,
  rectContains,
  clampPositionToRect,
  resolveNodeCollision,
  FALLBACK_NODE_WIDTH,
  FALLBACK_NODE_HEIGHT,
  type NsLayout,
} from "../utils/teachingFrame";
import {
  getWorkloadPodLabels,
  getHpaTarget,
  getVpaTarget,
  getConfigMapRefs,
  getConfigMapRefDetails,
  getPvcRefs,
  getPvcRefDetails,
  getPvForPvc,
  getStorageClassForPvc,
  getPvcsBoundToPv,
  getPvcsBoundToStorageClass,
  getSecretRefs,
  getSecretRefDetails,
  getGatewaysUsingClass,
  getRoutesForGateway,
  getRoutesForService,
  isGatewayApiKind,
  kindGroupLabel,
  isSingleNodeAccessMode,
  nodeIdFor,
  parallelismOf,
  cronParallelismOf,
  replicasOf,
  type K8sNodeData,
} from "../utils/buildGraph";
import { resourcesToYaml } from "../utils/serializeYaml";
import { setRfInstance } from "../utils/exportCanvas";
import CreateResourceModal from "./CreateResourceModal";
import CreateGatewayApiModal from "./CreateGatewayApiModal";
import ConfigMapDataEditor from "./ConfigMapDataEditor";
import ConfigMapLinkModal from "./ConfigMapLinkModal";
import PvcLinkModal from "./PvcLinkModal";
import SecretLinkModal from "./SecretLinkModal";
import IngressTlsLinkModal from "./IngressTlsLinkModal";
import NamespaceModal from "./NamespaceModal";
import DeleteNamespaceModal from "./DeleteNamespaceModal";

/** Register our custom node type so React Flow can render it */
const nodeTypes: NodeTypes = {
  k8sNode: K8sNode,
};

/** Presentational kind groups for the canvas toolbar (left → right). */
const RESOURCE_GROUPS: { label: string; kinds: SupportedKind[] }[] = [
  "Workload",
  "Network",
  "Storage",
  "Configuration",
].map((label) => ({
  label,
  kinds: SUPPORTED_KINDS.filter(
    (kind) => !isGatewayApiKind(kind) && kindGroupLabel(kind) === label,
  ),
}));
const DEFAULT_NAMESPACES = ["default", "kube-system", "kube-public"];
const SERVICE_TYPES = ["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"];

const KIND_COLORS: Record<string, string> = {
  Deployment: "#10b981",
  ReplicaSet: "#f97316",
  Pod: "#14b8a6",
  Service: "#3b82f6",
  Ingress: "#8b5cf6",
  HorizontalPodAutoscaler: "#f59e0b",
  ConfigMap: "#06b6d4",
  PersistentVolumeClaim: "#ec4899",
  PersistentVolume: "#84cc16",
  StorageClass: "#6366f1",
  Secret: "#dc2626",
  Job: "#eab308",
  CronJob: "#d946ef",
  VerticalPodAutoscaler: "#0ea5e9",
  GatewayClass: "#f43f5e",
  Gateway: "#7c3aed",
  HTTPRoute: "#0d9488",
  GRPCRoute: "#65a30d",
  TCPRoute: "#0284c7",
  TLSRoute: "#d97706",
  UDPRoute: "#16a34a",
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
  HorizontalPodAutoscaler: (
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
  ConfigMap: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6h16v12H4z" />
      <path d="M8 10h8M8 14h5" />
    </svg>
  ),
  PersistentVolumeClaim: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
    </svg>
  ),
  PersistentVolume: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </svg>
  ),
  StorageClass: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 10v4M17 10v4" strokeDasharray="2 2" />
    </svg>
  ),
  Secret: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
      <circle cx="12" cy="15.5" r="1.5" />
    </svg>
  ),
  Job: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 2v4M16 2v4M3 9h18" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  ),
  CronJob: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
      <path d="M12 4v3M12 17v3" />
    </svg>
  ),
  VerticalPodAutoscaler: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="12" width="4" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="12" rx="1" />
      <rect x="16" y="4" width="4" height="16" rx="1" />
      <path d="M5 12V9M11 8V5M17 4V7" strokeDasharray="2 2" />
    </svg>
  ),
  GatewayClass: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <circle cx="7" cy="16" r="1" />
      <circle cx="12" cy="16" r="1" />
      <circle cx="17" cy="16" r="1" />
    </svg>
  ),
  Gateway: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7h18v10H3z" />
      <path d="M8 10h4v4H8z" />
      <path d="M14.5 10h2.5v4h-2.5" />
    </svg>
  ),
  HTTPRoute: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 5l16 6-16 6" />
      <path d="M13 5h7v4" />
    </svg>
  ),
  GRPCRoute: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 5l16 6-16 6" />
      <path d="M15 4.5l4.5 1.5L15 7.5" />
      <path d="M15 16.5l4.5 1.5-4.5 1.5" />
    </svg>
  ),
  TCPRoute: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 5l16 6-16 6" />
      <circle cx="18" cy="18" r="3" />
    </svg>
  ),
  TLSRoute: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 5l16 6-16 6" />
      <rect x="14" y="12" width="8" height="6" rx="1" />
      <path d="M16 12v-1a2 2 0 014 0v1" />
    </svg>
  ),
  UDPRoute: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 5l16 6-16 6" />
      <circle cx="19" cy="18" r="2" />
      <path d="M19 8v6" strokeDasharray="2 2" />
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
  const [gatewayApiModalOpen, setGatewayApiModalOpen] = useState(false);
  const [gatewayApiDropdownOpen, setGatewayApiDropdownOpen] = useState(false);
  const [gaDropdownPos, setGaDropdownPos] = useState({ top: 0, left: 0 });
  const gaEntryRef = useRef<HTMLDivElement>(null);
  const gaDropdownRef = useRef<HTMLDivElement>(null);

  // Close the Gateway API dropdown on any outside pointerdown. The dropdown is
  // rendered outside the scrollable row (so the toolbar's overflow can't clip
  // it), so both the entry and the dropdown itself count as "inside".
  useEffect(() => {
    if (!gatewayApiDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (gaEntryRef.current?.contains(target)) return;
      if (gaDropdownRef.current?.contains(target)) return;
      setGatewayApiDropdownOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [gatewayApiDropdownOpen]);

  // Anchor the dropdown under the entry. The toolbar forms the containing
  // block (position: relative), so coordinates are computed relative to it —
  // getBoundingClientRect() viewport coords are converted by subtracting the
  // toolbar's own rect.
  const toggleGatewayApiDropdown = () => {
    const next = !gatewayApiDropdownOpen;
    if (next) {
      const entry = gaEntryRef.current;
      const toolbar = entry?.closest(".canvas-toolbar");
      if (entry && toolbar) {
        const entryRect = entry.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        setGaDropdownPos({
          top: entryRect.bottom - toolbarRect.top + 6,
          left: entryRect.left - toolbarRect.left,
        });
      }
    }
    setGatewayApiDropdownOpen(next);
  };

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
  const nsLayout = useVeltraStore((s) => s.nsLayout);
  const nsEditMode = useVeltraStore((s) => s.nsEditMode);
  const setNsEditMode = useVeltraStore((s) => s.setNsEditMode);
  const deleteNamespace = useVeltraStore((s) => s.deleteNamespace);
  // Persisted + auto-discovered cluster/namespace rectangles — the drop targets
  // for namespace reassignment and the frames NsFrame renders.
  const effectiveLayout = useMemo(
    () => effectiveNsLayout(nsLayout, nodes),
    [nsLayout, nodes],
  );
  // In namespace editing mode cluster-scoped kinds (PV/StorageClass) are fixed —
  // they can't be reassigned, so they must not be draggable at all. The React Flow
  // `selected` flag follows the store selection (single source of truth), so the
  // visual highlight also lands on nodes selected from the file explorer.
  const displayNodes = useMemo(() => {
    const selKey = selectedResource
      ? `${selectedResource.kind}:${selectedResource.name}`
      : "";
    return nodes.map((n) => {
      const node =
        nsEditMode && isClusterScoped(n.data.kind)
          ? { ...n, draggable: false }
          : n;
      const selected = selKey !== "" && `${n.data.kind}:${n.data.name}` === selKey;
      return node.selected === selected ? node : { ...node, selected };
    });
  }, [nodes, nsEditMode, selectedResource]);

  const namespaceOptions = useMemo(() => {
    const discovered = new Set<string>(DEFAULT_NAMESPACES);
    nodes.forEach((node) => {
      if (node.data?.namespace) discovered.add(node.data.namespace);
    });
    nsLayout?.namespaces?.forEach((ns) => discovered.add(ns.name));
    return Array.from(discovered).sort((a, b) => a.localeCompare(b));
  }, [nodes, nsLayout]);

  // Selectable `app` label values, with the real resources they come from —
  // selector fields are dropdowns over the live model, never free text.
  const selectorOptions = useMemo(() => {
    const owners = new Map<string, string[]>();
    nodes.forEach((node) => {
      if (node.data.synthetic) return;
      const kind = node.data.kind;
      let value: string | undefined;
      if (kind === "Deployment" || kind === "ReplicaSet" || kind === "Job") {
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

  // HorizontalPodAutoscaler scale targets: Deployments and ReplicaSets on the canvas
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

  // VPA targetRef candidates: every real pod-bearing resource on the canvas
  // (Deployments/ReplicaSets/Pods/Jobs/CronJobs). Synthetic nodes are excluded —
  // a targetRef must point at a manifest resource, not a controller-materialized one.
  const vpaTargetOptions = useMemo(
    () =>
      nodes
        .filter(
          (node) =>
            !node.data.synthetic &&
            (node.data.kind === "Deployment" ||
              node.data.kind === "ReplicaSet" ||
              node.data.kind === "Pod" ||
              node.data.kind === "Job" ||
              node.data.kind === "CronJob"),
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

  // Real VPAs whose spec.targetRef points at the selected workload/Pod —
  // read-only projection (mirrors the ConfigMap/Secret "Used by" sections).
  const vpaScaledBy = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (
      kind !== "Deployment" &&
      kind !== "ReplicaSet" &&
      kind !== "Pod" &&
      kind !== "Job" &&
      kind !== "CronJob"
    ) {
      return [];
    }
    return nodes
      .filter(
        (n) =>
          !n.data.synthetic &&
          n.data.kind === "VerticalPodAutoscaler" &&
          getVpaTarget(n.data.resource)?.kind === kind &&
          getVpaTarget(n.data.resource)?.name === selectedNode.data.name,
      )
      .map((n) => ({ kind: n.data.kind, name: n.data.name }));
  }, [nodes, selectedNode]);

  // When the selected workload is scaled by a HorizontalPodAutoscaler, replicas are clamped into
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
        n.data.kind === "HorizontalPodAutoscaler" &&
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

  // ConfigMaps referenced by the selected workload/Pod (from its Pod spec:
  // envFrom, env.valueFrom, volumes) — read-only projection of the YAML model.
  const selectedNodeConfigMaps = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (kind !== "Pod" && kind !== "Deployment" && kind !== "ReplicaSet" && kind !== "Job" && kind !== "CronJob") {
      return [];
    }
    return getConfigMapRefDetails(selectedNode.data.resource);
  }, [selectedNode]);

  // Real workloads/Pods that reference the selected ConfigMap by name —
  // read-only projection, no canvas edges (invariant 6).
  const configMapUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "ConfigMap") return [];
    return nodes
      .filter(
        (n) =>
          !n.data.synthetic &&
          (n.data.kind === "Deployment" ||
            n.data.kind === "ReplicaSet" ||
            n.data.kind === "Pod" ||
            n.data.kind === "Job" ||
            n.data.kind === "CronJob") &&
          getConfigMapRefs(n.data.resource).includes(selectedNode.data.name),
      )
      .map((n) => ({ kind: n.data.kind, name: n.data.name }));
  }, [nodes, selectedNode]);

  // Secrets referenced by the selected workload/Pod (from its Pod spec:
  // envFrom, env.valueFrom, volumes) — read-only projection of the YAML model.
  const selectedNodeSecrets = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (kind !== "Pod" && kind !== "Deployment" && kind !== "ReplicaSet" && kind !== "Job" && kind !== "CronJob") {
      return [];
    }
    return getSecretRefDetails(selectedNode.data.resource);
  }, [selectedNode]);

  // Real workloads/Pods that reference the selected Secret by name —
  // read-only projection, no canvas edges (invariant 6).
  const secretUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "Secret") return [];
    return nodes
      .filter(
        (n) =>
          !n.data.synthetic &&
          (n.data.kind === "Deployment" ||
            n.data.kind === "ReplicaSet" ||
            n.data.kind === "Pod" ||
            n.data.kind === "Job" ||
            n.data.kind === "CronJob") &&
          getSecretRefs(n.data.resource).includes(selectedNode.data.name),
      )
      .map((n) => ({ kind: n.data.kind, name: n.data.name }));
  }, [nodes, selectedNode]);

  // TLS entries of the selected Ingress (spec.tls[]): secret name + hosts.
  const ingressTlsEntries = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "Ingress") return [];
    const spec = selectedNode.data.resource.spec as
      | { tls?: Array<{ secretName?: string; hosts?: string[] }> }
      | undefined;
    return Array.isArray(spec?.tls) ? spec.tls : [];
  }, [selectedNode]);

  // PVCs referenced by the selected workload/Pod (spec.volumes[].persistentVolumeClaim) —
  // read-only projection of the YAML model.
  const selectedNodePvcs = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (kind !== "Pod" && kind !== "Deployment" && kind !== "ReplicaSet" && kind !== "Job" && kind !== "CronJob") {
      return [];
    }
    return getPvcRefDetails(selectedNode.data.resource);
  }, [selectedNode]);

  // Real workloads/Pods that claim the selected PVC by claimName.
  const pvcUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolumeClaim") {
      return [];
    }
    return nodes
      .filter(
        (n) =>
          !n.data.synthetic &&
          (n.data.kind === "Deployment" ||
            n.data.kind === "ReplicaSet" ||
            n.data.kind === "Pod" ||
            n.data.kind === "Job" ||
            n.data.kind === "CronJob") &&
          getPvcRefs(n.data.resource).includes(selectedNode.data.name),
      )
      .map((n) => ({ kind: n.data.kind, name: n.data.name }));
  }, [nodes, selectedNode]);

  // The single bind target of the selected PVC: PV via volumeName or StorageClass via
  // storageClassName (a PVC binds to exactly one — volumeName wins over storageClassName).
  const pvcBoundTo = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolumeClaim") {
      return null;
    }
    const pvName = getPvForPvc(selectedNode.data.resource);
    if (pvName) {
      return {
        kind: "PersistentVolume" as const,
        name: pvName,
        exists: nodes.some(
          (n) => n.data.kind === "PersistentVolume" && n.data.name === pvName,
        ),
      };
    }
    const scName = getStorageClassForPvc(selectedNode.data.resource);
    if (scName) {
      return {
        kind: "StorageClass" as const,
        name: scName,
        exists: nodes.some(
          (n) => n.data.kind === "StorageClass" && n.data.name === scName,
        ),
      };
    }
    return null;
  }, [nodes, selectedNode]);

  // PVCs bound to the selected PV (their spec.volumeName points at it).
  const pvBoundBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolume") return [];
    const resources = nodes
      .filter((n) => !n.data.synthetic)
      .map((n) => n.data.resource);
    return getPvcsBoundToPv(resources, selectedNode.data.name).map(
      (r) => r.metadata.name,
    );
  }, [nodes, selectedNode]);

  // PVCs referencing the selected StorageClass (their spec.storageClassName).
  const storageClassBoundBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "StorageClass") return [];
    const resources = nodes
      .filter((n) => !n.data.synthetic)
      .map((n) => n.data.resource);
    return getPvcsBoundToStorageClass(resources, selectedNode.data.name).map(
      (r) => r.metadata.name,
    );
  }, [nodes, selectedNode]);

  // PV/StorageClass name lists for the PVC inspector's binding dropdowns.
  const pvOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === "PersistentVolume")
        .map((n) => n.data.name as string)
        .sort((a, b) => a.localeCompare(b)),
    [nodes],
  );

  const storageClassOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === "StorageClass")
        .map((n) => n.data.name as string)
        .sort((a, b) => a.localeCompare(b)),
    [nodes],
  );

  // Gateway API: GatewayClass names (for a Gateway's gatewayClassName select),
  // Gateway names (for a Route's parentRefs select) and the live resource list
  // for the reverse projections below.
  const gatewayClassOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === "GatewayClass")
        .map((n) => n.data.name as string)
        .sort((a, b) => a.localeCompare(b)),
    [nodes],
  );

  const gatewayOptions = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === "Gateway")
        .map((n) => n.data.name as string)
        .sort((a, b) => a.localeCompare(b)),
    [nodes],
  );

  const realResources = useMemo(
    () => nodes.filter((n) => !n.data.synthetic).map((n) => n.data.resource),
    [nodes],
  );

  // Gateways whose spec.gatewayClassName points at the selected GatewayClass —
  // read-only "Used by Gateways" projection.
  const gatewayClassUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "GatewayClass") return [];
    return getGatewaysUsingClass(realResources, selectedNode.data.name).map(
      (r) => ({ kind: r.kind, name: r.metadata.name }),
    );
  }, [selectedNode, realResources]);

  // Routes whose spec.parentRefs[].name points at the selected Gateway —
  // read-only "Used by Routes" projection.
  const gatewayUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "Gateway") return [];
    return getRoutesForGateway(realResources, selectedNode.data.name).map(
      (r) => ({ kind: r.kind, name: r.metadata.name }),
    );
  }, [selectedNode, realResources]);

  // Routes whose spec.backendRefs[].name points at the selected Service —
  // read-only "Routed by" projection on the Service inspector.
  const serviceRoutedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "Service") return [];
    return getRoutesForService(realResources, selectedNode.data.name).map(
      (r) => ({ kind: r.kind, name: r.metadata.name }),
    );
  }, [selectedNode, realResources]);

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

  // ── Inspector edit buffer ───────────────────────────────────────────────
  // All inspector fields edit a local draft instead of the store; the draft is
  // committed to the model (and YAML) only when the user presses "Validate".
  // This lets labels/annotations accept partial input while typing instead of
  // round-tripping every keystroke through a lossy parser.
  const [draftResource, setDraftResource] = useState<K8sResource | null>(null);
  const [labelsDraft, setLabelsDraft] = useState("");
  const [annotationsDraft, setAnnotationsDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [draftErrors, setDraftErrors] = useState<{
    labels?: string;
    annotations?: string;
  }>({});
  const [lastDraftSig, setLastDraftSig] = useState<{
    selectionKey: string;
    sig: string;
  }>({ selectionKey: "", sig: "" });

  const committedResource = selectedNode?.data.resource ?? null;
  const draft = draftResource ?? committedResource;
  const draftKind = (draft?.kind ?? inspectorData?.kind) as SupportedKind;
  const draftSpec = (draft?.spec ?? {}) as Record<string, any>;
  const draftMetadata = (draft?.metadata ?? {}) as Record<string, any>;

  // Single-node access-mode guard: a PVC mounted by a multi-replica workload
  // can't be RWO/RWOP — identical Pods would all claim the same volume, and only
  // one node may attach it. Surfaced inline on the Access Modes field and blocks
  // the commit (mirrors the create-modal and drag interceptor).
  const pvcAccessModeViolation = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolumeClaim") {
      return null;
    }
    const current = draftResource ?? selectedNode.data.resource;
    if (!current || !isSingleNodeAccessMode(current as K8sResource)) return null;
    const draftMode = String(
      (current.spec as Record<string, any> | undefined)?.accessModes?.[0] ??
        "ReadWriteOnce",
    );
    const offender = pvcUsedBy.find((ref) => {
      if (ref.kind === "Job") {
        const node = nodes.find(
          (n) =>
            !n.data.synthetic && n.data.kind === ref.kind && n.data.name === ref.name,
        );
        return node ? parallelismOf(node.data.resource) > 1 : false;
      }
      if (ref.kind === "CronJob") {
        const node = nodes.find(
          (n) =>
            !n.data.synthetic && n.data.kind === ref.kind && n.data.name === ref.name,
        );
        return node ? cronParallelismOf(node.data.resource) > 1 : false;
      }
      if (ref.kind !== "Deployment" && ref.kind !== "ReplicaSet") return false;
      const node = nodes.find(
        (n) =>
          !n.data.synthetic && n.data.kind === ref.kind && n.data.name === ref.name,
      );
      return node ? replicasOf(node.data.resource) > 1 : false;
    });
    if (!offender) return null;
    if (offender.kind === "Job") {
      return `${draftMode} can only attach to one node, but Job ${offender.name} runs more than 1 pod in parallel. Reduce parallelism or use ReadWriteMany/ReadOnlyMany.`;
    }
    if (offender.kind === "CronJob") {
      return `${draftMode} can only attach to one node, but CronJob ${offender.name} runs more than 1 pod in parallel. Reduce parallelism or use ReadWriteMany/ReadOnlyMany.`;
    }
    return `${draftMode} can only attach to one node, but ${offender.kind} ${offender.name} runs more than 1 replica. Scale it down or use ReadWriteMany/ReadOnlyMany.`;
  }, [selectedNode, draftResource, pvcUsedBy, nodes]);

  /** Empty string = valid; otherwise the validation error to show. */
  const validateDraftName = useCallback(
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

  const nameError = draftResource
    ? validateDraftName(draftKind, nameDraft)
    : "";

  // True when the draft holds anything the model doesn't — gates the
  // Validate Changes button.
  const dirty = useMemo(() => {
    if (!selectedNode || !draftResource || isManaged) return false;
    const committed = selectedNode.data.resource;
    const structuredChanged =
      JSON.stringify(draftResource) !== JSON.stringify(committed);
    const labelsChanged =
      labelsDraft !== toKeyValueString(committed.metadata?.labels);
    const annotationsChanged =
      annotationsDraft !==
      toKeyValueString(
        committed.metadata?.annotations as Record<string, string> | undefined,
      );
    const nameChanged = nameDraft.trim() !== (committed.metadata?.name ?? "");
    return (
      structuredChanged || labelsChanged || annotationsChanged || nameChanged
    );
  }, [
    selectedNode,
    draftResource,
    labelsDraft,
    annotationsDraft,
    nameDraft,
    isManaged,
  ]);

  // Re-initialize the draft when a different resource is selected or when the
  // committed resource changed without pending edits (external sync, e.g. YAML
  // edits or HorizontalPodAutoscaler replica clamps). Never clobber in-progress typing.
  if (selectedNode && !isManaged) {
    const sig = JSON.stringify(selectedNode.data.resource);
    const needsInit =
      draftResource === null ||
      lastDraftSig.selectionKey !== selectionKey ||
      (lastDraftSig.sig !== sig && !dirty);
    if (needsInit) {
      setLastDraftSig({ selectionKey, sig });
      setDraftResource(selectedNode.data.resource);
      setLabelsDraft(
        toKeyValueString(selectedNode.data.resource.metadata?.labels),
      );
      setAnnotationsDraft(
        toKeyValueString(
          selectedNode.data.resource.metadata?.annotations as
            | Record<string, string>
            | undefined,
        ),
      );
      setNameDraft(selectedNode.data.resource.metadata?.name ?? "");
      setDraftErrors({});
    }
  }

  /** Merge a partial patch into the draft (metadata/spec merge like the old helper). */
  const patchDraft = useCallback(
    (patch: {
      kind?: SupportedKind;
      apiVersion?: string;
      metadata?: Record<string, unknown>;
      spec?: Record<string, unknown>;
      data?: Record<string, string> | undefined;
    }) => {
      setDraftResource((prev) => {
        const base = prev ?? selectedNode?.data.resource ?? null;
        if (!base) return null;
        return {
          ...base,
          ...patch,
          metadata: {
            ...(base.metadata ?? {}),
            ...(patch.metadata ?? {}),
          },
          spec: {
            ...(base.spec as Record<string, unknown> | undefined),
            ...(patch.spec ?? {}),
          },
        };
      });
    },
    // `prev` is the authoritative base once the draft exists; the selected
    // node is only the fallback for the first (pre-init) frame.
    [selectedNode],
  );

  /** Adopt the freshly-committed node back into the draft after Validate. */
  const syncDraftFromStore = useCallback((nodeId: string) => {
    const state = useVeltraStore.getState();
    const fresh = state.nodes.find((n) => n.id === nodeId) ?? null;
    const resource = fresh?.data.resource ?? null;
    if (!resource) return;
    const sel = state.selectedResource;
    const freshKey = sel ? `${sel.kind}:${sel.name}` : "";
    setDraftResource(resource);
    setLabelsDraft(toKeyValueString(resource.metadata?.labels));
    setAnnotationsDraft(
      toKeyValueString(
        resource.metadata?.annotations as Record<string, string> | undefined,
      ),
    );
    setNameDraft(resource.metadata?.name ?? "");
    setDraftErrors({});
    setLastDraftSig({ selectionKey: freshKey, sig: JSON.stringify(resource) });
  }, []);

  /** Validate the draft and commit it to the model through the store. */
  const handleValidate = useCallback(() => {
    if (!selectedNode || !draftResource || isManaged) return;
    const committed = selectedNode.data.resource;

    const errors: { labels?: string; annotations?: string } = {};
    const labelsError = keyValueError(labelsDraft);
    if (labelsError) errors.labels = labelsError;
    const annotationsError = keyValueError(annotationsDraft);
    if (annotationsError) errors.annotations = annotationsError;
    if (Object.keys(errors).length > 0) {
      setDraftErrors(errors);
      return;
    }
    setDraftErrors({});

    const kind = draftResource.kind as SupportedKind;
    const name = nameDraft.trim();

    // Empty/duplicate names are surfaced inline on the Name field — block the
    // commit so the model is never left invalid (invariant 8).
    if (validateDraftName(kind, name)) return;

    // Single-node access-mode guard (invariant 14): a RWO/RWOP claim mounted by
    // a multi-replica workload is impossible — the inline error explains why.
    if (pvcAccessModeViolation) return;

    // The final resource: raw string drafts parsed into the structured model.
    const metadata: K8sResource["metadata"] = {
      ...(draftResource.metadata ?? {}),
      name,
      labels: parseKeyValueString(labelsDraft),
      annotations: parseKeyValueString(annotationsDraft),
    };
    // Cluster-scoped kinds (PV/StorageClass) never carry a namespace — strip any
    // stale value the draft may have inherited from YAML.
    if (isClusterScoped(kind)) {
      delete metadata.namespace;
    }
    const finalResource: K8sResource = {
      ...draftResource,
      kind,
      apiVersion: apiVersionForKind(kind),
      metadata,
    };

    // Renames go through the identity path so reference cascades run
    // (Ingress backends, HorizontalPodAutoscaler scaleTargetRefs, ConfigMap/PVC/PV/SC refs) and
    // manual edges + stored positions are remapped.
    let nodeId = selectedNode.id;
    if (name !== committed.metadata?.name) {
      updateNodeFromCanvas(nodeId, { name });
      nodeId = nodeIdFor(kind, name);
    }
    updateNodeResourceFromCanvas(nodeId, finalResource);
    syncDraftFromStore(nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, draftResource, labelsDraft, annotationsDraft, nameDraft, isManaged, pvcAccessModeViolation]);

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
  // attempt, not a move — resources are fixed in place and move only with their
  // rectangle. The pre-drag positions let us snap everything back on drop.
  const dragOriginRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // The cluster/namespace rectangles captured at drag start. Auto-derived
  // layouts re-hug the live nodes every render, so clamping against the *live*
  // layout would let a dragged node drag its own boundary along — the captured
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
      typeof n.style?.height === "number" ? n.style.height : FALLBACK_NODE_HEIGHT;
    if (isClusterScoped(n.data.kind)) {
      return resolveNodeCollision(
        n.position.x,
        n.position.y,
        width,
        height,
        null,
        layout.namespaces,
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
    // re-renders are batched — the render-scope `nodes` is one frame behind, so
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

  // Dragging only moves nodes — positions are persisted once on drop and the
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
      // final onNodeDrag — re-apply the constraint so the node doesn't jump out
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
        // final onNodeDrag — re-apply the constraint so the node doesn't jump out
        // of its box at the end of the gesture, then push the dropped node out of
        // any resource it overlaps (node-vs-node collision — a dropped node never
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
            .filter((o) => o.id !== n.id && !o.parentId && !draggedIds.has(o.id))
            .map(nodeRect);
          let pos;
          if (isClusterScoped(n.data.kind)) {
            pos = resolveNodeCollision(
              clamped.x,
              clamped.y,
              width,
              height,
              null,
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
    // Namespace editing: resources are fixed — snap every dragged node back to
    // its pre-drag position, then interpret the drop as a reassignment attempt.
    // A node dropped in ANOTHER namespace is reassigned by the placement engine
    // (store `updateNodeFromCanvas`): it lands at a free spot inside the target
    // box, which grows when the resource doesn't fit — same guarantees as
    // creation. The drop anchor is the POINTER position (in flow coordinates),
    // not the node center — large workloads dwarf their target rectangles, and
    // the user aims at the rectangle with the cursor, not the node's centroid.
    const origins = dragOriginRef.current;
    const pointer = flowPointFromScreen(
      event as { clientX?: number; clientY?: number },
    );
    // Use the layout captured at drag start — the live layout re-hugs the dragged
    // node mid-drag, which would make the node's own box follow the pointer and
    // the target lookup unreliable.
    const dropLayout = dragLayoutRef.current ?? effectiveLayout;
    // Auto-derived rectangles can overlap (a big workload's namespace box can
    // surround a smaller one) — the drop target is the SMALLEST box containing
    // the pointer, i.e. the most specific namespace.
    const findDropTarget = (point: { x: number; y: number }) =>
      dropLayout.namespaces
        .filter((ns) => rectContains(ns, point))
        .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const reassignedIds: string[] = [];
    const storeNodes = useVeltraStore.getState().nodes;
    const nextNodes = storeNodes.map((n) => {
      const origin = origins.get(n.id);
      if (!origin) return n;
      // Synthetic nodes belong to their owner's namespace; cluster-scoped kinds
      // never have a namespace — neither can be reassigned. Both snap back.
      if (n.data.synthetic || isClusterScoped(n.data.kind)) {
        return { ...n, position: origin };
      }
      const width =
        typeof n.style?.width === "number" ? n.style.width : FALLBACK_NODE_WIDTH;
      const height =
        typeof n.style?.height === "number" ? n.style.height : FALLBACK_NODE_HEIGHT;
      const center = { x: n.position.x + width / 2, y: n.position.y + height / 2 };
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
      // free, growing the box when needed) — no pinning here, that placement is
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

  // Add an empty namespace: modal asks for the name, then a default-size
  // rectangle is dropped below the cluster. Validation is inline in the modal
  // and re-checked by the store.
  const [namespaceModalOpen, setNamespaceModalOpen] = useState(false);

  // Namespace awaiting cascade-delete confirmation (only opened when it has
  // resources — empty boxes are deleted immediately).
  const [deleteNsTarget, setDeleteNsTarget] = useState<{
    name: string;
    count: number;
  } | null>(null);

  // × on a namespace frame: empty boxes vanish right away; boxes holding
  // resources pause in a confirmation before the cascade.
  const onDeleteNamespace = useCallback(
    (name: string) => {
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
    },
    [nodes, deleteNamespace],
  );

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

  return (
    <div className="canvas-panel">
      <div className="panel-header">
        <span className="panel-header__accent" />
        <span className="panel-header__title">Resource Canvas</span>
      </div>

      {/* Quick Actions Toolbar */}
      <div className="canvas-toolbar">
        <div className="canvas-toolbar__group canvas-toolbar__group--grow">
          <div
            className="canvas-toolbar__scroll"
            onScroll={() => setGatewayApiDropdownOpen(false)}
          >
            {RESOURCE_GROUPS.map((group, gi) => (
              <Fragment key={group.label}>
                {gi > 0 && (
                  <span className="canvas-toolbar__group-divider" aria-hidden="true" />
                )}
                <span className="canvas-toolbar__group-label">{group.label}</span>
                {group.kinds.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className="canvas-button"
                    onClick={() => {
                      setGatewayApiModalOpen(false);
                      setPendingKind(kind);
                    }}
                    title={`Add ${kind} resource`}
                  >
                    + {kind}
                  </button>
                ))}
                {group.label === "Network" && (
                  <div className="canvas-toolbar__ga-entry" ref={gaEntryRef}>
                    <button
                      type="button"
                      className="canvas-button"
                      onClick={() => {
                        setGatewayApiDropdownOpen(false);
                        setPendingKind(null);
                        setGatewayApiModalOpen(true);
                      }}
                      title="Create a GatewayClass, Gateway and Routes in one flow"
                    >
                      + Gateway API
                    </button>
                    <button
                      type="button"
                      className={`canvas-button canvas-button--chevron ${
                        gatewayApiDropdownOpen ? "canvas-button--chevron--open" : ""
                      }`}
                      onClick={toggleGatewayApiDropdown}
                      title="Reveal the Gateway API resources (GatewayClass, Gateway, routes)"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        width="12"
                        height="12"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
          {gatewayApiDropdownOpen && (
            <div
              className="canvas-toolbar__dropdown"
              ref={gaDropdownRef}
              style={{ top: gaDropdownPos.top, left: gaDropdownPos.left }}
            >
              {SUPPORTED_KINDS.filter((kind) => isGatewayApiKind(kind)).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="canvas-button canvas-toolbar__dropdown-item"
                  onClick={() => {
                    setGatewayApiDropdownOpen(false);
                    setGatewayApiModalOpen(false);
                    setPendingKind(kind);
                  }}
                  title={`Add ${kind} resource`}
                >
                  + {kind}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="canvas-toolbar__group">
          {nsEditMode && (
            <button
              type="button"
              className="canvas-button"
              onClick={() => setNamespaceModalOpen(true)}
              title="Add an empty namespace rectangle to the cluster"
            >
              + Namespace
            </button>
          )}
          <button
            type="button"
            className={`canvas-button canvas-button--nsmode${nsEditMode ? " canvas-button--active" : ""}`}
            onClick={() => setNsEditMode(!nsEditMode)}
            title={
              nsEditMode
                ? "Exit namespace editing mode (layout is saved)"
                : "Enter namespace editing mode — drag, resize and add namespace boxes"
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="8" height="8" rx="1.5" />
              <rect x="13" y="3" width="8" height="8" rx="1.5" />
              <rect x="3" y="13" width="8" height="8" rx="1.5" />
              <rect x="13" y="13" width="8" height="8" rx="1.5" />
            </svg>
            {nsEditMode ? "Done" : "Namespaces"}
          </button>
        </div>
      </div>

      <div className="canvas-wrapper">
        <div className="canvas-body">
          <div className="canvas-flow-host">
            <ReactFlow
              nodes={displayNodes}
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
              onNodeDragStart={onNodeDragStart}
              onNodeDrag={onNodeDrag}
              onNodeDragStop={onNodeDragStop}
              onInit={onFlowInit}
              nodesDraggable
              nodesConnectable={!nsEditMode}
              // Resources are fixed in NS mode (drags snap back), so edge auto-pan
              // would only shift the view mid-drag and mislead the drop target.
              autoPanOnNodeDrag={!nsEditMode}
              selectionOnDrag={false}
              elevateEdgesOnSelect={false}
              proOptions={{ hideAttribution: true }}
            >
              {/* Cluster/namespace bounding frames — editable in namespace editing mode */}
              <NsFrame layout={effectiveLayout} nodes={nodes} onDeleteNamespace={onDeleteNamespace} />
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
                      HorizontalPodAutoscaler {o.hpaName} has more priority — {o.kind} {o.name}{" "}
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
                    {inspectorData.namespace && !isClusterScoped(inspectorData.kind) && (
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
                          value={draftKind}
                          onChange={(e) => {
                            const next = e.target.value as SupportedKind;
                            setDraftResource((prev) => {
                              const base =
                                prev ?? selectedNode.data.resource;
                              return {
                                ...base,
                                kind: next,
                                apiVersion: apiVersionForKind(next),
                              };
                            });
                          }}
                        >
                          {SUPPORTED_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                      </div>
                      <NameField
                        value={nameDraft}
                        error={nameError}
                        onChange={setNameDraft}
                      />
                      {!isClusterScoped(draftKind) && (
                        <div className="inspector-field">
                          <label className="inspector-field__label">
                            Namespace
                          </label>
                          <input
                            className="inspector-field__input"
                            value={(draftMetadata.namespace as string) ?? ""}
                            list={namespaceListId}
                            onChange={(e) =>
                              patchDraft({
                                metadata: {
                                  namespace: e.target.value || undefined,
                                },
                              })
                            }
                            placeholder="default"
                          />
                        </div>
                      )}
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
                          className={`inspector-field__input ${
                            draftErrors.labels
                              ? "inspector-field__input--invalid"
                              : ""
                          }`}
                          value={labelsDraft}
                          onChange={(e) => {
                            setLabelsDraft(e.target.value);
                            setDraftErrors((prev) => ({
                              ...prev,
                              labels: undefined,
                            }));
                          }}
                          placeholder="app=my-app,tier=frontend"
                        />
                        {draftErrors.labels && (
                          <span className="inspector-field__error">
                            {draftErrors.labels}
                          </span>
                        )}
                        {(() => {
                          const parsed = parseKeyValueString(labelsDraft);
                          return parsed && Object.keys(parsed).length > 0 ? (
                            <div className="inspector-label-chips">
                              {Object.entries(parsed).map(([k, v]) => (
                                <span key={k} className="inspector-label-chip">
                                  {k}={v}
                                </span>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Annotations
                        </label>
                        <input
                          className={`inspector-field__input ${
                            draftErrors.annotations
                              ? "inspector-field__input--invalid"
                              : ""
                          }`}
                          value={annotationsDraft}
                          onChange={(e) => {
                            setAnnotationsDraft(e.target.value);
                            setDraftErrors((prev) => ({
                              ...prev,
                              annotations: undefined,
                            }));
                          }}
                          placeholder="owner=team-a"
                        />
                        {draftErrors.annotations && (
                          <span className="inspector-field__error">
                            {draftErrors.annotations}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Scaling (Deployment / ReplicaSet) ── */}
                {!isManaged &&
                  (draftKind === "Deployment" ||
                    draftKind === "ReplicaSet") && (
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
                            value={String(draftSpec?.replicas ?? "")}
                            onChange={(e) =>
                              patchDraft({
                                spec: {
                                  ...draftSpec,
                                  replicas: toOptionalNumber(e.target.value),
                                },
                              })
                            }
                            placeholder="3"
                          />
                          <span className="inspector-field__hint">
                            Pods are materialized on the canvas to match this
                            count, like a real cluster.
                          </span>
                          {hpaConstraint && (
                            <span className="inspector-field__hint inspector-field__hint--hpa">
                              HorizontalPodAutoscaler {hpaConstraint.name} has priority — replicas
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
                              (draftSpec?.selector?.matchLabels?.app as
                                | string
                                | undefined) ?? "";
                            const ownName =
                              nameDraft.trim() || (selectedNode.data.name as string);
                            const known = selectorOptions.some(
                              (o) => o.value === current,
                            );
                            return (
                              <select
                                className="inspector-field__input inspector-field__input--select"
                                value={current}
                                onChange={(e) =>
                                  patchDraft({
                                    spec: {
                                      ...draftSpec,
                                      selector: e.target.value
                                        ? {
                                            ...(draftSpec?.selector ?? {}),
                                            matchLabels: {
                                              app: e.target.value,
                                            },
                                          }
                                        : undefined,
                                    },
                                  })
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

                {/* ── Section: Job (parallelism/completions/restart) ── */}
                {!isManaged && draftKind === "Job" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="3" y="4" width="18" height="16" rx="2" />
                        <path d="M8 2v4M16 2v4M3 9h18" />
                        <path d="M9 14l2 2 4-4" />
                      </svg>
                      Job
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Restart Policy
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.template?.spec?.restartPolicy ?? "OnFailure",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                template: {
                                  ...(draftSpec?.template ?? {}),
                                  spec: {
                                    ...(draftSpec?.template?.spec ?? {}),
                                    restartPolicy: e.target.value,
                                  },
                                },
                              },
                            })
                          }
                        >
                          <option>OnFailure</option>
                          <option>Never</option>
                        </select>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Parallelism
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(draftSpec?.parallelism ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                parallelism: toOptionalNumber(e.target.value),
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          This many Pods are materialized on the canvas, like a
                          real cluster.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Completions
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(draftSpec?.completions ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                completions: toOptionalNumber(e.target.value),
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          Total Pods to run to completion.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Containers (Job) ───────────── */}
                {!isManaged && draftKind === "Job" && (
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
                          value={String(
                            draftSpec?.template?.spec?.containers?.[0]?.name ??
                              "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                template: {
                                  ...(draftSpec?.template ?? {}),
                                  spec: {
                                    ...(draftSpec?.template?.spec ?? {}),
                                    containers: [
                                      {
                                        ...(draftSpec?.template?.spec
                                          ?.containers?.[0] ?? {}),
                                        name: e.target.value,
                                      },
                                    ],
                                  },
                                },
                              },
                            })
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.template?.spec?.containers?.[0]?.image ??
                              "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                template: {
                                  ...(draftSpec?.template ?? {}),
                                  spec: {
                                    ...(draftSpec?.template?.spec ?? {}),
                                    containers: [
                                      {
                                        ...(draftSpec?.template?.spec
                                          ?.containers?.[0] ?? {}),
                                        image: e.target.value,
                                      },
                                    ],
                                  },
                                },
                              },
                            })
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: CronJob (schedule/job template) ── */}
                {!isManaged && draftKind === "CronJob" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 3" />
                        <path d="M12 4v3M12 17v3" />
                      </svg>
                      CronJob
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">Schedule</label>
                        <input
                          className={`inspector-field__input ${cronScheduleError(String(draftSpec?.schedule ?? "")) ? "inspector-field__input--invalid" : ""}`}
                          value={String(draftSpec?.schedule ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                schedule: e.target.value,
                              },
                            })
                          }
                          placeholder="* * * * *"
                        />
                        <span className="inspector-field__hint">
                          5-field cron (minute hour day month weekday) or an
                          @-descriptor like @hourly.
                        </span>
                        {cronScheduleError(String(draftSpec?.schedule ?? "")) && (
                          <span className="inspector-field__error">
                            {cronScheduleError(String(draftSpec?.schedule ?? ""))}
                          </span>
                        )}
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Restart Policy
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.restartPolicy ?? "OnFailure",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        restartPolicy: e.target.value,
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                        >
                          <option>OnFailure</option>
                          <option>Never</option>
                        </select>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Parallelism
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            draftSpec?.jobTemplate?.spec?.parallelism ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    parallelism: toOptionalNumber(e.target.value),
                                  },
                                },
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          This many Pods run at the same time on each scheduled run.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Completions
                        </label>
                        <input
                          className="inspector-field__input"
                          type="number"
                          min={1}
                          value={String(
                            draftSpec?.jobTemplate?.spec?.completions ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    completions: toOptionalNumber(e.target.value),
                                  },
                                },
                              },
                            })
                          }
                          placeholder="1"
                        />
                        <span className="inspector-field__hint">
                          Total Pods the created Job runs to completion.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Containers (CronJob) ───────── */}
                {!isManaged && draftKind === "CronJob" && (
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
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.name ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            name: e.target.value,
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.image ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            image: e.target.value,
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Shell command (optional)
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.jobTemplate?.spec?.template?.spec
                              ?.containers?.[0]?.args?.[0] ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                jobTemplate: {
                                  ...(draftSpec?.jobTemplate ?? {}),
                                  spec: {
                                    ...(draftSpec?.jobTemplate?.spec ?? {}),
                                    template: {
                                      ...(draftSpec?.jobTemplate?.spec
                                        ?.template ?? {}),
                                      spec: {
                                        ...(draftSpec?.jobTemplate?.spec
                                          ?.template?.spec ?? {}),
                                        containers: [
                                          {
                                            ...(draftSpec?.jobTemplate?.spec
                                              ?.template?.spec
                                              ?.containers?.[0] ?? {}),
                                            command: ["/bin/sh", "-c"],
                                            args: [e.target.value],
                                          },
                                        ],
                                      },
                                    },
                                  },
                                },
                              },
                            })
                          }
                          placeholder="echo hello && date"
                        />
                        <span className="inspector-field__hint">
                          Runs /bin/sh -c &quot;&lt;command&gt;&quot; instead of
                          the image&apos;s default command. Clear to run the
                          image&apos;s default.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Containers (Pod) ───────────── */}
                {!isManaged && draftKind === "Pod" && (
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
                          value={String(
                            draftSpec?.containers?.[0]?.name ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                containers: [
                                  {
                                    ...(draftSpec?.containers?.[0] ?? {}),
                                    name: e.target.value,
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="app"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Image</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.containers?.[0]?.image ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                containers: [
                                  {
                                    ...(draftSpec?.containers?.[0] ?? {}),
                                    image: e.target.value,
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="nginx:latest"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Config Maps (workloads/Pods) ── */}
                {!isManaged &&
                  (inspectorData.kind === "Pod" ||
                    inspectorData.kind === "Deployment" ||
                    inspectorData.kind === "ReplicaSet" ||
                    inspectorData.kind === "Job" ||
                    inspectorData.kind === "CronJob") &&
                  selectedNodeConfigMaps.length > 0 && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 6h16v12H4z" />
                          <path d="M8 10h8M8 14h5" />
                        </svg>
                        Config Maps
                        <span className="inspector-section__count">
                          {selectedNodeConfigMaps.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {selectedNodeConfigMaps.map((ref) => {
                            const exists = nodes.some(
                              (n) =>
                                n.data.kind === "ConfigMap" &&
                                n.data.name === ref.name,
                            );
                            return (
                              <button
                                key={`${ref.name}:${ref.mechanism}:${ref.key ?? ""}`}
                                type="button"
                                className="inspector-rel-item inspector-rel-item--link"
                                title={
                                  exists
                                    ? `Select ConfigMap ${ref.name}`
                                    : `ConfigMap ${ref.name} is referenced but not on the canvas`
                                }
                                onClick={() =>
                                  setSelectedResource({
                                    kind: "ConfigMap",
                                    name: ref.name,
                                  })
                                }
                              >
                                <span
                                  className="inspector-rel-arrow inspector-rel-arrow--outgoing"
                                  title="referenced"
                                >
                                  ▤
                                </span>
                                <div className="inspector-rel-info">
                                  <span className="inspector-rel-kind">
                                    ConfigMap
                                  </span>
                                  <span className="inspector-rel-name">
                                    {ref.name}
                                  </span>
                                </div>
                                <span className="inspector-rel-badge">
                                  {ref.mechanism}
                                  {ref.mechanism === "envKey" && ref.key
                                    ? `:${ref.key}`
                                    : ""}
                                </span>
                                {!exists && (
                                  <span className="inspector-rel-badge">
                                    missing
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <span className="inspector-field__hint">
                          Referenced via envFrom / env.valueFrom / volumes in
                          this Pod spec. Editable in the YAML.
                        </span>
                      </div>
                    </div>
                  )}
                {/* ── Section: Secrets (workloads/Pods) ── */}
                {!isManaged &&
                  (inspectorData.kind === "Pod" ||
                    inspectorData.kind === "Deployment" ||
                    inspectorData.kind === "ReplicaSet" ||
                    inspectorData.kind === "Job" ||
                    inspectorData.kind === "CronJob") &&
                  selectedNodeSecrets.length > 0 && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V7a4 4 0 018 0v4" />
                          <circle cx="12" cy="15.5" r="1.5" />
                        </svg>
                        Secrets
                        <span className="inspector-section__count">
                          {selectedNodeSecrets.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {selectedNodeSecrets.map((ref) => {
                            const exists = nodes.some(
                              (n) =>
                                n.data.kind === "Secret" &&
                                n.data.name === ref.name,
                            );
                            return (
                              <button
                                key={`${ref.name}:${ref.mechanism}:${ref.key ?? ""}`}
                                type="button"
                                className="inspector-rel-item inspector-rel-item--link"
                                title={
                                  exists
                                    ? `Select Secret ${ref.name}`
                                    : `Secret ${ref.name} is referenced but not on the canvas`
                                }
                                onClick={() =>
                                  setSelectedResource({
                                    kind: "Secret",
                                    name: ref.name,
                                  })
                                }
                              >
                                <span
                                  className="inspector-rel-arrow inspector-rel-arrow--outgoing"
                                  title="referenced"
                                >
                                  ▤
                                </span>
                                <div className="inspector-rel-info">
                                  <span className="inspector-rel-kind">
                                    Secret
                                  </span>
                                  <span className="inspector-rel-name">
                                    {ref.name}
                                  </span>
                                </div>
                                <span className="inspector-rel-badge">
                                  {ref.mechanism}
                                  {ref.mechanism === "envKey" && ref.key
                                    ? `:${ref.key}`
                                    : ""}
                                </span>
                                {!exists && (
                                  <span className="inspector-rel-badge">
                                    missing
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <span className="inspector-field__hint">
                          Referenced via envFrom / env.valueFrom / volumes in
                          this Pod spec. Editable in the YAML.
                        </span>
                      </div>
                    </div>
                  )}
                {/* ── Section: Persistent Volume Claims (workloads/Pods) ── */}
                {!isManaged &&
                  (inspectorData.kind === "Pod" ||
                    inspectorData.kind === "Deployment" ||
                    inspectorData.kind === "ReplicaSet" ||
                    inspectorData.kind === "Job" ||
                    inspectorData.kind === "CronJob") &&
                  selectedNodePvcs.length > 0 && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <ellipse cx="12" cy="5" rx="8" ry="3" />
                          <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
                          <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
                        </svg>
                        Persistent Volume Claims
                        <span className="inspector-section__count">
                          {selectedNodePvcs.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {selectedNodePvcs.map((ref) => {
                            const exists = nodes.some(
                              (n) =>
                                n.data.kind === "PersistentVolumeClaim" &&
                                n.data.name === ref.name,
                            );
                            return (
                              <button
                                key={`${ref.name}:${ref.volumeName}`}
                                type="button"
                                className="inspector-rel-item inspector-rel-item--link"
                                title={
                                  exists
                                    ? `Select PVC ${ref.name}`
                                    : `PVC ${ref.name} is referenced but not on the canvas`
                                }
                                onClick={() =>
                                  setSelectedResource({
                                    kind: "PersistentVolumeClaim",
                                    name: ref.name,
                                  })
                                }
                              >
                                <span
                                  className="inspector-rel-arrow inspector-rel-arrow--outgoing"
                                  title="claimed"
                                >
                                  ▤
                                </span>
                                <div className="inspector-rel-info">
                                  <span className="inspector-rel-kind">
                                    PersistentVolumeClaim
                                  </span>
                                  <span className="inspector-rel-name">
                                    {ref.name}
                                  </span>
                                </div>
                                <span className="inspector-rel-badge">
                                  vol: {ref.volumeName}
                                </span>
                                {!exists && (
                                  <span className="inspector-rel-badge">
                                    missing
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        <span className="inspector-field__hint">
                          Claimed via spec.volumes[].persistentVolumeClaim in
                          this Pod spec. Editable in the YAML.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Data (ConfigMap) ─────────────── */}
                {!isManaged && draftKind === "ConfigMap" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M4 6h16v12H4z" />
                        <path d="M8 10h8M8 14h5" />
                      </svg>
                      Data
                    </div>
                    <div className="inspector-section__body">
                      <ConfigMapDataEditor
                        resource={draft ?? selectedNode.data.resource}
                        resetToken={selectionKey}
                        onCommit={(data) =>
                          setDraftResource((prev) => ({
                            ...(prev ?? selectedNode.data.resource),
                            data,
                          }))
                        }
                      />
                    </div>
                  </div>
                )}

                {/* ── Section: Used by (ConfigMap) ─────────── */}
                {inspectorData.kind === "ConfigMap" &&
                  configMapUsedBy.length > 0 && (
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
                        Used by
                        <span className="inspector-section__count">
                          {configMapUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {configMapUsedBy.map((ref) => (
                            <button
                              key={`${ref.kind}:${ref.name}`}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select ${ref.kind} ${ref.name}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: ref.kind,
                                  name: ref.name,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  {ref.kind}
                                </span>
                                <span className="inspector-rel-name">
                                  {ref.name}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Resources referencing this ConfigMap via envFrom /
                          env.valueFrom / volumes in their Pod spec.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Data (Secret) ─────────────── */}
                {!isManaged && draftKind === "Secret" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 018 0v4" />
                        <circle cx="12" cy="15.5" r="1.5" />
                      </svg>
                      Data
                    </div>
                    <div className="inspector-section__body">
                      <ConfigMapDataEditor
                        resource={draft ?? selectedNode.data.resource}
                        resetToken={selectionKey}
                        onCommit={(data) =>
                          setDraftResource((prev) => ({
                            ...(prev ?? selectedNode.data.resource),
                            data,
                          }))
                        }
                      />
                      <span className="inspector-field__hint">
                        Plaintext key/value pairs — Kubernetes expects
                        base64-encoded values in spec.data. Values are stored
                        as-is.
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Section: Used by (Secret) ─────────── */}
                {inspectorData.kind === "Secret" &&
                  secretUsedBy.length > 0 && (
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
                        Used by
                        <span className="inspector-section__count">
                          {secretUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {secretUsedBy.map((ref) => (
                            <button
                              key={`${ref.kind}:${ref.name}`}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select ${ref.kind} ${ref.name}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: ref.kind,
                                  name: ref.name,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  {ref.kind}
                                </span>
                                <span className="inspector-rel-name">
                                  {ref.name}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Resources referencing this Secret via envFrom /
                          env.valueFrom / volumes in their Pod spec.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Storage (PersistentVolumeClaim) ── */}
                {!isManaged && draftKind === "PersistentVolumeClaim" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <ellipse cx="12" cy="5" rx="8" ry="3" />
                        <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
                        <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
                      </svg>
                      Storage
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Access Modes
                        </label>
                        <select
                          className={`inspector-field__input inspector-field__input--select ${
                            pvcAccessModeViolation
                              ? "inspector-field__input--invalid"
                              : ""
                          }`}
                          value={String(
                            draftSpec?.accessModes?.[0] ?? "ReadWriteOnce",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                accessModes: [e.target.value],
                              },
                            })
                          }
                        >
                          <option>ReadWriteOnce</option>
                          <option>ReadOnlyMany</option>
                          <option>ReadWriteMany</option>
                          <option>ReadWriteOncePod</option>
                        </select>
                        {pvcAccessModeViolation && (
                          <span className="inspector-field__error">
                            {pvcAccessModeViolation}
                          </span>
                        )}
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Size Request
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.resources?.requests?.storage ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                resources: {
                                  requests: {
                                    storage: e.target.value,
                                  },
                                },
                              },
                            })
                          }
                          placeholder="1Gi"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Bind to StorageClass
                        </label>
                        {(() => {
                          const current = String(
                            draftSpec?.storageClassName ?? "",
                          );
                          const known = storageClassOptions.includes(current);
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) => {
                                const value = e.target.value;
                                const spec = { ...draftSpec };
                                if (value) {
                                  spec.storageClassName = value;
                                  delete spec.volumeName;
                                } else {
                                  delete spec.storageClassName;
                                  delete spec.volumeName;
                                }
                                patchDraft({ spec });
                              }}
                            >
                              <option value="">
                                (unbound — no storageClassName)
                              </option>
                              {storageClassOptions.map((sc) => (
                                <option key={sc} value={sc}>
                                  {sc}
                                </option>
                              ))}
                              {current && !known && (
                                <option value={current}>
                                  {current} (missing)
                                </option>
                              )}
                            </select>
                          );
                        })()}
                        <span className="inspector-field__hint">
                          Setting this clears spec.volumeName — a PVC binds to
                          exactly one of PV or StorageClass.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Bind to PV
                        </label>
                        {(() => {
                          const current = String(
                            draftSpec?.volumeName ?? "",
                          );
                          const known = pvOptions.includes(current);
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) => {
                                const value = e.target.value;
                                const spec = { ...draftSpec };
                                if (value) {
                                  spec.volumeName = value;
                                  delete spec.storageClassName;
                                } else {
                                  delete spec.volumeName;
                                  delete spec.storageClassName;
                                }
                                patchDraft({ spec });
                              }}
                            >
                              <option value="">
                                (no volumeName — unbound or via StorageClass)
                              </option>
                              {pvOptions.map((pv) => (
                                <option key={pv} value={pv}>
                                  {pv}
                                </option>
                              ))}
                              {current && !known && (
                                <option value={current}>
                                  {current} (missing)
                                </option>
                              )}
                            </select>
                          );
                        })()}
                        <span className="inspector-field__hint">
                          Setting this clears spec.storageClassName.
                        </span>
                      </div>
                      {pvcBoundTo && (
                        <div className="inspector-static-row">
                          <span className="inspector-static-row__key">
                            Bound to
                          </span>
                          <span
                            className="inspector-static-row__val"
                            title={pvcBoundTo.name}
                          >
                            {pvcBoundTo.kind === "PersistentVolume" ? "PV" : "StorageClass"}{" "}
                            {pvcBoundTo.name}
                            {!pvcBoundTo.exists ? " (missing)" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Section: Mounted by (PersistentVolumeClaim) ── */}
                {inspectorData.kind === "PersistentVolumeClaim" &&
                  pvcUsedBy.length > 0 && (
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
                        Mounted by
                        <span className="inspector-section__count">
                          {pvcUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {pvcUsedBy.map((ref) => (
                            <button
                              key={`${ref.kind}:${ref.name}`}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select ${ref.kind} ${ref.name}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: ref.kind,
                                  name: ref.name,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  {ref.kind}
                                </span>
                                <span className="inspector-rel-name">
                                  {ref.name}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Resources claiming this PVC via spec.volumes[].
                          persistentVolumeClaim.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Networking (Service) ───────── */}
                {draftKind === "Service" && (
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
                          value={draftSpec?.type ?? ""}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                type: e.target.value || undefined,
                              },
                            })
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
                            (draftSpec?.selector?.app as string | undefined) ??
                            "";
                          const known = selectorOptions.some(
                            (o) => o.value === current,
                          );
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    selector: e.target.value
                                      ? { app: e.target.value }
                                      : undefined,
                                  },
                                })
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
                          value={String(draftSpec?.ports?.[0]?.port ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                ports: [
                                  {
                                    ...(draftSpec?.ports?.[0] ?? {}),
                                    port: toOptionalNumber(e.target.value),
                                  },
                                ],
                              },
                            })
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
                            draftSpec?.ports?.[0]?.targetPort ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                ports: [
                                  {
                                    ...(draftSpec?.ports?.[0] ?? {}),
                                    targetPort:
                                      toOptionalNumber(e.target.value) ??
                                      (e.target.value || undefined),
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="8080"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Routing (Ingress) ──────────── */}
                {draftKind === "Ingress" && (
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
                          value={String(draftSpec?.rules?.[0]?.host ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                rules: [
                                  {
                                    ...(draftSpec?.rules?.[0] ?? {}),
                                    host: e.target.value,
                                  },
                                ],
                              },
                            })
                          }
                          placeholder="my-app.example.com"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">Path</label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.rules?.[0]?.http?.paths?.[0]?.path ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                rules: [
                                  {
                                    ...(draftSpec?.rules?.[0] ?? {}),
                                    http: {
                                      ...(draftSpec?.rules?.[0]?.http ?? {}),
                                      paths: [
                                        {
                                          ...(draftSpec?.rules?.[0]?.http
                                            ?.paths?.[0] ?? {}),
                                          path: e.target.value,
                                        },
                                      ],
                                    },
                                  },
                                ],
                              },
                            })
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
                            (draftSpec?.rules?.[0]?.http?.paths?.[0]?.backend
                              ?.service?.name as string | undefined) ?? ""
                          }
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                rules: [
                                  {
                                    ...(draftSpec?.rules?.[0] ?? {}),
                                    http: {
                                      ...(draftSpec?.rules?.[0]?.http ?? {}),
                                      paths: [
                                        {
                                          ...(draftSpec?.rules?.[0]?.http
                                            ?.paths?.[0] ?? {}),
                                          backend: e.target.value
                                            ? {
                                                service: {
                                                  name: e.target.value,
                                                  port: {
                                                    number: Number(
                                                      draftSpec?.rules?.[0]
                                                        ?.http?.paths?.[0]
                                                        ?.backend?.service?.port
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
                            })
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

                {/* ── Section: TLS (Ingress) ──────────────── */}
                {!isManaged && draftKind === "Ingress" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="5" y="11" width="14" height="9" rx="2" />
                        <path d="M8 11V7a4 4 0 018 0v4" />
                        <circle cx="12" cy="15.5" r="1.5" />
                      </svg>
                      TLS
                      {ingressTlsEntries.length > 0 && (
                        <span className="inspector-section__count">
                          {ingressTlsEntries.length}
                        </span>
                      )}
                    </div>
                    <div className="inspector-section__body">
                      {ingressTlsEntries.length === 0 && (
                        <span className="inspector-field__hint">
                          No spec.tls[] entries. Drag an Ingress onto a Secret to
                          terminate TLS, or edit the YAML.
                        </span>
                      )}
                      {ingressTlsEntries.map((entry, idx) => {
                        const exists = nodes.some(
                          (n) =>
                            n.data.kind === "Secret" &&
                            n.data.name === entry.secretName,
                        );
                        return (
                          <div
                            key={`${entry.secretName ?? idx}:${idx}`}
                            className="inspector-field"
                          >
                            <label className="inspector-field__label">
                              TLS #{idx + 1} — Secret
                            </label>
                            <div className="inspector-rel-list">
                              <button
                                type="button"
                                className="inspector-rel-item inspector-rel-item--link"
                                title={
                                  exists
                                    ? `Select Secret ${entry.secretName}`
                                    : `Secret ${entry.secretName} is referenced but not on the canvas`
                                }
                                onClick={() =>
                                  entry.secretName &&
                                  setSelectedResource({
                                    kind: "Secret",
                                    name: entry.secretName,
                                  })
                                }
                              >
                                <span className="inspector-rel-arrow inspector-rel-arrow--outgoing">
                                  ▤
                                </span>
                                <div className="inspector-rel-info">
                                  <span className="inspector-rel-kind">
                                    Secret
                                  </span>
                                  <span className="inspector-rel-name">
                                    {entry.secretName}
                                  </span>
                                </div>
                                {!exists && (
                                  <span className="inspector-rel-badge">
                                    missing
                                  </span>
                                )}
                              </button>
                            </div>
                            <label className="inspector-field__label">
                              Hosts
                            </label>
                            <input
                              className="inspector-field__input"
                              value={(entry.hosts ?? []).join(", ")}
                              readOnly
                              placeholder="(all hosts)"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Section: Autoscaling (HorizontalPodAutoscaler) ─────────── */}
                {!isManaged && draftKind === "HorizontalPodAutoscaler" && (
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
                          const ref = draftSpec?.scaleTargetRef as
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
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    scaleTargetRef: e.target.value
                                      ? {
                                          apiVersion: "apps/v1",
                                          kind: e.target.value.split("|")[0],
                                          name: e.target.value.split("|")[1],
                                        }
                                      : undefined,
                                  },
                                })
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
                          value={String(draftSpec?.minReplicas ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                minReplicas: toOptionalNumber(e.target.value),
                              },
                            })
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
                          value={String(draftSpec?.maxReplicas ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                maxReplicas: toOptionalNumber(e.target.value),
                              },
                            })
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
                            draftSpec?.metrics?.[0]?.resource?.target
                              ?.averageUtilization ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
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
                            })
                          }
                          placeholder="70"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Autoscaling (VPA) ────────── */}
                {!isManaged && draftKind === "VerticalPodAutoscaler" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="4" y="12" width="4" height="8" rx="1" />
                        <rect x="10" y="8" width="4" height="12" rx="1" />
                        <rect x="16" y="4" width="4" height="16" rx="1" />
                        <path d="M5 12V9M11 8V5M17 4V7" strokeDasharray="2 2" />
                      </svg>
                      Autoscaling
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Target (targetRef)
                        </label>
                        {(() => {
                          const ref = draftSpec?.targetRef as
                            | { kind?: string; name?: string }
                            | undefined;
                          const current =
                            ref?.kind && ref.name
                              ? `${ref.kind}|${ref.name}`
                              : "";
                          const known = vpaTargetOptions.some(
                            (w) => `${w.kind}|${w.name}` === current,
                          );
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    targetRef: e.target.value
                                      ? {
                                          apiVersion: (() => {
                                            const targetKind =
                                              e.target.value.split("|")[0];
                                            return targetKind ===
                                                "Deployment" ||
                                              targetKind === "ReplicaSet"
                                              ? "apps/v1"
                                              : targetKind === "Job" ||
                                                  targetKind === "CronJob"
                                              ? "batch/v1"
                                              : "v1";
                                          })(),
                                          kind: e.target.value.split("|")[0],
                                          name: e.target.value.split("|")[1],
                                        }
                                      : undefined,
                                  },
                                })
                              }
                            >
                              <option value="">(no target)</option>
                              {vpaTargetOptions.map((w) => (
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
                          Lists the Deployments, ReplicaSets, Pods, Jobs and
                          CronJobs currently on the canvas.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Update Mode
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.updatePolicy?.updateMode ?? "Auto",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                updatePolicy: {
                                  ...(draftSpec?.updatePolicy ?? {}),
                                  updateMode: e.target.value || undefined,
                                },
                              },
                            })
                          }
                        >
                          <option value="Auto">Auto</option>
                          <option value="Initial">Initial</option>
                          <option value="Recreate">Recreate</option>
                          <option value="Off">Off</option>
                        </select>
                        <span className="inspector-field__hint">
                          Auto applies recommended requests to new Pods, Initial
                          only to the first, Recreate evicts running Pods, Off
                          never applies.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Min CPU
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.resourcePolicy?.containerPolicies?.[0]
                              ?.minAllowed?.cpu ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                resourcePolicy: {
                                  ...(draftSpec?.resourcePolicy ?? {}),
                                  containerPolicies: [
                                    {
                                      ...(draftSpec?.resourcePolicy
                                        ?.containerPolicies?.[0] ?? {
                                        containerName: "*",
                                      }),
                                      minAllowed: {
                                        ...(draftSpec?.resourcePolicy
                                          ?.containerPolicies?.[0]
                                          ?.minAllowed ?? {}),
                                        cpu: e.target.value || undefined,
                                      },
                                    },
                                  ],
                                },
                              },
                            })
                          }
                          placeholder="100m"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Max CPU
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.resourcePolicy?.containerPolicies?.[0]
                              ?.maxAllowed?.cpu ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                resourcePolicy: {
                                  ...(draftSpec?.resourcePolicy ?? {}),
                                  containerPolicies: [
                                    {
                                      ...(draftSpec?.resourcePolicy
                                        ?.containerPolicies?.[0] ?? {
                                        containerName: "*",
                                      }),
                                      maxAllowed: {
                                        ...(draftSpec?.resourcePolicy
                                          ?.containerPolicies?.[0]
                                          ?.maxAllowed ?? {}),
                                        cpu: e.target.value || undefined,
                                      },
                                    },
                                  ],
                                },
                              },
                            })
                          }
                          placeholder="1"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Min Memory
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.resourcePolicy?.containerPolicies?.[0]
                              ?.minAllowed?.memory ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                resourcePolicy: {
                                  ...(draftSpec?.resourcePolicy ?? {}),
                                  containerPolicies: [
                                    {
                                      ...(draftSpec?.resourcePolicy
                                        ?.containerPolicies?.[0] ?? {
                                        containerName: "*",
                                      }),
                                      minAllowed: {
                                        ...(draftSpec?.resourcePolicy
                                          ?.containerPolicies?.[0]
                                          ?.minAllowed ?? {}),
                                        memory: e.target.value || undefined,
                                      },
                                    },
                                  ],
                                },
                              },
                            })
                          }
                          placeholder="256Mi"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Max Memory
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(
                            draftSpec?.resourcePolicy?.containerPolicies?.[0]
                              ?.maxAllowed?.memory ?? "",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                resourcePolicy: {
                                  ...(draftSpec?.resourcePolicy ?? {}),
                                  containerPolicies: [
                                    {
                                      ...(draftSpec?.resourcePolicy
                                        ?.containerPolicies?.[0] ?? {
                                        containerName: "*",
                                      }),
                                      maxAllowed: {
                                        ...(draftSpec?.resourcePolicy
                                          ?.containerPolicies?.[0]
                                          ?.maxAllowed ?? {}),
                                        memory: e.target.value || undefined,
                                      },
                                    },
                                  ],
                                },
                              },
                            })
                          }
                          placeholder="2Gi"
                        />
                      </div>
                      <span className="inspector-field__hint">
                        Bounds apply to the first containerPolicy
                        (containerName &quot;*&quot;). Clear to leave unbounded.
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Section: Capacity (PersistentVolume) ── */}
                {!isManaged && draftKind === "PersistentVolume" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
                        <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
                      </svg>
                      Capacity
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">Capacity</label>
                        <input
                          className="inspector-field__input"
                          value={String(draftSpec?.capacity?.storage ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                capacity: { storage: e.target.value },
                              },
                            })
                          }
                          placeholder="10Gi"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Access Modes
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.accessModes?.[0] ?? "ReadWriteOnce",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                accessModes: [e.target.value],
                              },
                            })
                          }
                        >
                          <option>ReadWriteOnce</option>
                          <option>ReadOnlyMany</option>
                          <option>ReadWriteMany</option>
                          <option>ReadWriteOncePod</option>
                        </select>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Reclaim Policy
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(
                            draftSpec?.persistentVolumeReclaimPolicy ?? "Retain",
                          )}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                persistentVolumeReclaimPolicy: e.target.value,
                              },
                            })
                          }
                        >
                          <option>Retain</option>
                          <option>Recycle</option>
                          <option>Delete</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Bound to PVC (PersistentVolume) ── */}
                {inspectorData.kind === "PersistentVolume" &&
                  pvBoundBy.length > 0 && (
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
                        Bound to PVC
                        <span className="inspector-section__count">
                          {pvBoundBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {pvBoundBy.map((pvcName) => (
                            <button
                              key={pvcName}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select PVC ${pvcName}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: "PersistentVolumeClaim",
                                  name: pvcName,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  PersistentVolumeClaim
                                </span>
                                <span className="inspector-rel-name">
                                  {pvcName}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Claims whose spec.volumeName points at this PV.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Provisioning (StorageClass) ── */}
                {!isManaged && draftKind === "StorageClass" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="4" width="18" height="6" rx="2" />
                        <rect x="3" y="14" width="18" height="6" rx="2" />
                        <path d="M7 10v4M17 10v4" strokeDasharray="2 2" />
                      </svg>
                      Provisioning
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Provisioner
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(draftSpec?.provisioner ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                provisioner: e.target.value,
                              },
                            })
                          }
                          placeholder="kubernetes.io/no-provisioner"
                        />
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Reclaim Policy
                        </label>
                        <select
                          className="inspector-field__input inspector-field__input--select"
                          value={String(draftSpec?.reclaimPolicy ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                reclaimPolicy: e.target.value || undefined,
                              },
                            })
                          }
                        >
                          <option value="">(default: Delete)</option>
                          <option>Delete</option>
                          <option>Retain</option>
                          <option>Recycle</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Bound PVCs (StorageClass) ── */}
                {inspectorData.kind === "StorageClass" &&
                  storageClassBoundBy.length > 0 && (
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
                        Bound PVCs
                        <span className="inspector-section__count">
                          {storageClassBoundBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {storageClassBoundBy.map((pvcName) => (
                            <button
                              key={pvcName}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select PVC ${pvcName}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: "PersistentVolumeClaim",
                                  name: pvcName,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  PersistentVolumeClaim
                                </span>
                                <span className="inspector-rel-name">
                                  {pvcName}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Claims whose spec.storageClassName references this
                          class.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Vertical scaled by (VPA targets) ── */}
                {(inspectorData.kind === "Deployment" ||
                  inspectorData.kind === "ReplicaSet" ||
                  inspectorData.kind === "Pod" ||
                  inspectorData.kind === "Job" ||
                  inspectorData.kind === "CronJob") &&
                  vpaScaledBy.length > 0 && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="4" y="12" width="4" height="8" rx="1" />
                          <rect x="10" y="8" width="4" height="12" rx="1" />
                          <rect x="16" y="4" width="4" height="16" rx="1" />
                          <path d="M5 12V9M11 8V5M17 4V7" strokeDasharray="2 2" />
                        </svg>
                        Vertical scaled by
                        <span className="inspector-section__count">
                          {vpaScaledBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {vpaScaledBy.map((ref) => (
                            <button
                              key={`${ref.kind}:${ref.name}`}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select ${ref.kind} ${ref.name}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: ref.kind as SupportedKind,
                                  name: ref.name,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  {ref.kind}
                                </span>
                                <span className="inspector-rel-name">
                                  {ref.name}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          VPAs whose spec.targetRef points at this resource —
                          they right-size the resource requests of its Pods.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Controller (GatewayClass) ── */}
                {!isManaged && draftKind === "GatewayClass" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="M3 9h18" />
                        <circle cx="7" cy="16" r="1" />
                        <circle cx="12" cy="16" r="1" />
                        <circle cx="17" cy="16" r="1" />
                      </svg>
                      Controller
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Controller Name
                        </label>
                        <input
                          className="inspector-field__input"
                          value={String(draftSpec?.controllerName ?? "")}
                          onChange={(e) =>
                            patchDraft({
                              spec: {
                                ...draftSpec,
                                controllerName: e.target.value || undefined,
                              },
                            })
                          }
                          placeholder="acme.io/gateway-controller"
                        />
                        <span className="inspector-field__hint">
                          The controller that reconciles Gateways of this class.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Used by Gateways (GatewayClass) ── */}
                {inspectorData.kind === "GatewayClass" &&
                  gatewayClassUsedBy.length > 0 && (
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
                        Used by Gateways
                        <span className="inspector-section__count">
                          {gatewayClassUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {gatewayClassUsedBy.map((ref) => (
                            <button
                              key={`${ref.kind}:${ref.name}`}
                              type="button"
                              className="inspector-rel-item inspector-rel-item--link"
                              title={`Select ${ref.kind} ${ref.name}`}
                              onClick={() =>
                                setSelectedResource({
                                  kind: ref.kind as SupportedKind,
                                  name: ref.name,
                                })
                              }
                            >
                              <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                                ↑
                              </span>
                              <div className="inspector-rel-info">
                                <span className="inspector-rel-kind">
                                  {ref.kind}
                                </span>
                                <span className="inspector-rel-name">
                                  {ref.name}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                        <span className="inspector-field__hint">
                          Gateways whose spec.gatewayClassName references this
                          class.
                        </span>
                      </div>
                    </div>
                  )}

                {/* ── Section: Gateway — class ── */}
                {!isManaged && draftKind === "Gateway" && (
                  <div className="inspector-section">
                    <div className="inspector-section__header">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 7h18v10H3z" />
                        <path d="M8 10h4v4H8z" />
                        <path d="M14.5 10h2.5v4h-2.5" />
                      </svg>
                      Gateway Class
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Class
                        </label>
                        {(() => {
                          const current = String(draftSpec?.gatewayClassName ?? "");
                          const known = gatewayClassOptions.includes(current);
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    gatewayClassName: e.target.value || undefined,
                                  },
                                })
                              }
                            >
                              <option value="">(no class)</option>
                              {gatewayClassOptions.map((gc) => (
                                <option key={gc} value={gc}>
                                  {gc}
                                </option>
                              ))}
                              {current && !known && (
                                <option value={current}>{current} (missing)</option>
                              )}
                            </select>
                          );
                        })()}
                        <span className="inspector-field__hint">
                          A Gateway is created from exactly one GatewayClass.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Used by Routes (Gateway) ── */}
                {inspectorData.kind === "Gateway" && gatewayUsedBy.length > 0 && (
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
                      Used by Routes
                      <span className="inspector-section__count">
                        {gatewayUsedBy.length}
                      </span>
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-rel-list">
                        {gatewayUsedBy.map((ref) => (
                          <button
                            key={`${ref.kind}:${ref.name}`}
                            type="button"
                            className="inspector-rel-item inspector-rel-item--link"
                            title={`Select ${ref.kind} ${ref.name}`}
                            onClick={() =>
                              setSelectedResource({
                                kind: ref.kind as SupportedKind,
                                name: ref.name,
                              })
                            }
                          >
                            <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                              ↑
                            </span>
                            <div className="inspector-rel-info">
                              <span className="inspector-rel-kind">
                                {ref.kind}
                              </span>
                              <span className="inspector-rel-name">
                                {ref.name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <span className="inspector-field__hint">
                        Routes whose spec.parentRefs point at this Gateway.
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Section: Routes — parent + backends ── */}
                {!isManaged &&
                  (draftKind === "HTTPRoute" ||
                    draftKind === "GRPCRoute" ||
                    draftKind === "TCPRoute" ||
                    draftKind === "TLSRoute" ||
                    draftKind === "UDPRoute") && (
                    <div className="inspector-section">
                      <div className="inspector-section__header">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 19V5" />
                          <path d="M4 5l16 6-16 6" />
                        </svg>
                        Routing
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-field">
                          <label className="inspector-field__label">
                            Parent Gateway
                          </label>
                          {(() => {
                            const refs: any[] = Array.isArray(draftSpec?.parentRefs)
                              ? draftSpec.parentRefs
                              : [];
                            const current = String(refs[0]?.name ?? "");
                            const known = gatewayOptions.includes(current);
                            return (
                              <select
                                className="inspector-field__input inspector-field__input--select"
                                value={current}
                                onChange={(e) =>
                                  patchDraft({
                                    spec: {
                                      ...draftSpec,
                                      parentRefs: e.target.value
                                        ? [{ name: e.target.value }]
                                        : undefined,
                                    },
                                  })
                                }
                              >
                                <option value="">(no parent)</option>
                                {gatewayOptions.map((gw) => (
                                  <option key={gw} value={gw}>
                                    {gw}
                                  </option>
                                ))}
                                {current && !known && (
                                  <option value={current}>{current} (missing)</option>
                                )}
                              </select>
                            );
                          })()}
                        </div>
                        {draftKind !== "TCPRoute" && draftKind !== "UDPRoute" && (
                          <div className="inspector-field">
                            <label className="inspector-field__label">
                              Hostnames
                            </label>
                            <input
                              className="inspector-field__input"
                              value={(() => {
                                const hs: any[] = Array.isArray(draftSpec?.hostnames)
                                  ? draftSpec.hostnames
                                  : [];
                                return hs.join(", ");
                              })()}
                              onChange={(e) =>
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    hostnames: e.target.value.trim()
                                      ? e.target.value
                                          .split(/[\s,]+/)
                                          .map((h: string) => h.trim())
                                          .filter(Boolean)
                                      : undefined,
                                  },
                                })
                              }
                              placeholder="api.example.com"
                            />
                          </div>
                        )}
                        <div className="inspector-field">
                          <label className="inspector-field__label">
                            Backend Services
                          </label>
                          {(() => {
                            const refs: any[] = Array.isArray(draftSpec?.backendRefs)
                              ? draftSpec.backendRefs
                              : [];
                            const patchRefs = (next: any[]) =>
                              patchDraft({
                                spec: {
                                  ...draftSpec,
                                  backendRefs: next.length ? next : undefined,
                                },
                              });
                            return (
                              <>
                                {refs.map((ref, i) => (
                                  <div className="inspector-backend-row" key={i}>
                                    <select
                                      className="inspector-field__input inspector-field__input--select"
                                      value={String(ref?.name ?? "")}
                                      onChange={(e) => {
                                        const next = [...refs];
                                        next[i] = { ...next[i], name: e.target.value };
                                        patchRefs(next);
                                      }}
                                    >
                                      <option value="">(pick a Service)</option>
                                      {serviceOptions.map((svc) => (
                                        <option key={svc} value={svc}>
                                          {svc}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      className="inspector-backend-remove"
                                      title="Remove backend"
                                      onClick={() =>
                                        patchRefs(refs.filter((_, j) => j !== i))
                                      }
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="inspector-rel-item inspector-rel-item--link"
                                  onClick={() => patchRefs([...refs, { name: "" }])}
                                >
                                  + Add backend Service
                                </button>
                              </>
                            );
                          })()}
                          <span className="inspector-field__hint">
                            Routes only route to Services (spec.backendRefs).
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                {/* ── Section: Routed by (Service) ── */}
                {inspectorData.kind === "Service" && serviceRoutedBy.length > 0 && (
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
                      Routed by
                      <span className="inspector-section__count">
                        {serviceRoutedBy.length}
                      </span>
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-rel-list">
                        {serviceRoutedBy.map((ref) => (
                          <button
                            key={`${ref.kind}:${ref.name}`}
                            type="button"
                            className="inspector-rel-item inspector-rel-item--link"
                            title={`Select ${ref.kind} ${ref.name}`}
                            onClick={() =>
                              setSelectedResource({
                                kind: ref.kind as SupportedKind,
                                name: ref.name,
                              })
                            }
                          >
                            <span className="inspector-rel-arrow inspector-rel-arrow--incoming">
                              ↑
                            </span>
                            <div className="inspector-rel-info">
                              <span className="inspector-rel-kind">
                                {ref.kind}
                              </span>
                              <span className="inspector-rel-name">
                                {ref.name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <span className="inspector-field__hint">
                        Gateway API routes whose spec.backendRefs point at this
                        Service.
                      </span>
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

                {/* ── Footer: Validate + Delete ───────────── */}
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
                    <div className="inspector-footer__actions">
                      <button
                        type="button"
                        className="inspector-validate-btn"
                        disabled={!dirty}
                        onClick={handleValidate}
                        title={
                          dirty
                            ? "Apply the pending inspector changes to the resource"
                            : "No pending changes"
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Validate Changes
                      </button>
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
                    </div>
                    {dirty && (
                      <span className="inspector-footer__hint">
                        Changes are applied to the resource (and YAML) when you
                        press Validate Changes.
                      </span>
                    )}
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

      {/* Gateway API bundle creation modal */}
      {gatewayApiModalOpen && (
        <CreateGatewayApiModal onClose={() => setGatewayApiModalOpen(false)} />
      )}

      {/* Post-drag mechanism prompt for ConfigMap → workload connections */}
      <ConfigMapLinkModal />

      {/* Post-drag volume-name prompt for PVC → Pod connections */}
      <PvcLinkModal />

      {/* Post-drag mechanism prompt for Secret → workload connections */}
      <SecretLinkModal />

      {/* Post-drag hosts prompt for Ingress → Secret TLS connections */}
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

// ─── Name field with validation ─────────────────────────────────────────────

/**
 * Controlled name editor for the inspector. The value is a local draft owned by
 * the inspector; nothing is committed until "Validate Changes" is pressed, so
 * partial input is never round-tripped through the model.
 */
function NameField({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string;
  onChange: (name: string) => void;
}) {
  return (
    <div className="inspector-field">
      <label className="inspector-field__label">Name</label>
      <input
        className={`inspector-field__input ${error ? "inspector-field__input--invalid" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="resource-name"
      />
      {error && <span className="inspector-field__error">{error}</span>}
    </div>
  );
}

// ─── Helper functions ───────────────────────────────────────────────────────

/**
 * Convert screen (client) coordinates to flow coordinates. Mirrors React Flow's
 * own screenToFlowPosition: the viewport transform is applied relative to the
 * flow renderer's bounding box, so that offset must be subtracted too.
 */
function flowPointFromScreen(e: {
  clientX?: number;
  clientY?: number;
}): { x: number; y: number } | null {
  if (typeof e?.clientX !== "number" || typeof e.clientY !== "number") return null;
  const renderer = document.querySelector(".react-flow__renderer") as HTMLElement | null;
  const viewport = document.querySelector(".react-flow__viewport") as HTMLElement | null;
  if (!renderer || !viewport) return null;
  const bounds = renderer.getBoundingClientRect();
  const m = new DOMMatrixReadOnly(viewport.style.transform);
  return {
    x: (e.clientX - bounds.left - m.e) / m.a,
    y: (e.clientY - bounds.top - m.f) / m.d,
  };
}

function toOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Empty string = valid; otherwise the cron-schedule validation error to show. */
function cronScheduleError(schedule: string): string {
  const trimmed = schedule.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) return "";
  return trimmed.split(/\s+/).length === 5
    ? ""
    : "A cron schedule has 5 fields: minute hour day month weekday (e.g. \"* * * * *\").";
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

/** Empty string = valid; otherwise the first malformed key=value entry. */
function keyValueError(value: string): string {
  const tokens = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      return `Invalid entry “${token}” — use key=value pairs separated by commas.`;
    }
    if (!token.slice(0, eq).trim()) {
      return `Invalid entry “${token}” — the key can't be empty.`;
    }
  }
  return "";
}

function toKeyValueString(value: Record<string, string> | undefined): string {
  if (!value) return "";
  return Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}
