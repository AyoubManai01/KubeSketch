import { useMemo } from "react";
import { type Edge, type Node } from "@xyflow/react";
import {
  getConfigMapRefDetails,
  getConfigMapRefs,
  getGatewaysUsingClass,
  getHpaTarget,
  getPvForPvc,
  getPvcRefDetails,
  getPvcRefs,
  getPvcsBoundToPv,
  getPvcsBoundToStorageClass,
  getRoutesForGateway,
  getRoutesForService,
  getSecretRefDetails,
  getSecretRefs,
  getStorageClassForPvc,
  getVpaTarget,
  getWorkloadPodLabels,
  type K8sNodeData,
} from "../../utils/buildGraph";
import { resourcesToYaml } from "../../utils/serializeYaml";
import { effectiveNsLayout, type NsLayout } from "../../utils/teachingFrame";
import { KIND_COLORS, KIND_ICONS } from "../kindMeta";
import type { K8sResource, SupportedKind } from "../../types/types";
import type { SelectedResource } from "../../store/store";

export interface CanvasModel {
  selectedNode: Node<K8sNodeData> | null;
  selectionKey: string;
  effectiveLayout: NsLayout;
  hasStructureFrames: boolean;
  namespaceOptions: string[];
  selectorOptions: Array<{ value: string; owners: string }>;
  serviceOptions: string[];
  workloadOptions: Array<{ kind: string; name: string }>;
  vpaTargetOptions: Array<{ kind: string; name: string }>;
  vpaScaledBy: Array<{ kind: string; name: string }>;
  hpaConstraint: { name: string; min?: number; max?: number } | null;
  selectedNodeConfigMaps: Array<{
    name: string;
    mechanism: "envFrom" | "envKey" | "volumes";
    key?: string;
  }>;
  configMapUsedBy: Array<{ kind: string; name: string }>;
  selectedNodeSecrets: Array<{
    name: string;
    mechanism: "envFrom" | "envKey" | "volumes";
    key?: string;
  }>;
  secretUsedBy: Array<{ kind: string; name: string }>;
  ingressTlsEntries: Array<{ secretName?: string; hosts?: string[] }>;
  selectedNodePvcs: Array<{ name: string; volumeName: string }>;
  pvcUsedBy: Array<{ kind: string; name: string }>;
  pvcBoundTo: {
    kind: "PersistentVolume" | "StorageClass";
    name: string;
    exists: boolean;
  } | null;
  pvBoundBy: string[];
  storageClassBoundBy: string[];
  pvOptions: string[];
  storageClassOptions: string[];
  gatewayClassOptions: string[];
  gatewayOptions: string[];
  gatewayClassUsedBy: Array<{ kind: string; name: string }>;
  gatewayUsedBy: Array<{ kind: string; name: string }>;
  serviceRoutedBy: Array<{ kind: string; name: string }>;
  relationships: Array<{
    key: string;
    kind: SupportedKind;
    name: string;
    direction: "outgoing" | "incoming" | "owns" | "owned-by";
    label: string;
  }>;
  resourceYaml: string;
  inspectorData: {
    kind: string;
    name: string;
    namespace?: string;
    apiVersion: string;
    color: string;
    icon: React.ReactNode;
  } | null;
  isManaged: boolean;
  managedOwner: { kind: SupportedKind; name: string } | null;
}

/**
 * All derived projections of the canvas model: the selected node lookup, the
 * option lists populated from the live graph, the read-only reverse-reference
 * lists, the relationships and the YAML preview. Pure memos over the store
 * state, no side effects.
 */
export function useCanvasModel(
  nodes: Node<K8sNodeData>[],
  edges: Edge[],
  nsLayout: NsLayout | null,
  selectedResource: SelectedResource | null,
): CanvasModel {
  // Selection lives in the store as {kind, name} so it survives node ID changes
  // (renames, kind changes). The node is looked up fresh on every render.
  const selectedNode = useMemo(() => {
    if (!selectedResource) return null;
    return (
      nodes.find(
        (n) =>
          !n.data.synthetic &&
          n.data.kind === selectedResource.kind &&
          n.data.name === selectedResource.name,
      ) ??
      nodes.find(
        (n) =>
          n.data.kind === selectedResource.kind &&
          n.data.name === selectedResource.name,
      ) ??
      null
    );
  }, [nodes, selectedResource]);

  const selectionKey = selectedResource
    ? `${selectedResource.kind}:${selectedResource.name}`
    : "";

  // Persisted + auto-discovered cluster/namespace rectangles: the drop targets
  // for namespace reassignment and the frames NsFrame renders.
  const effectiveLayout = useMemo(
    () => effectiveNsLayout(nsLayout, nodes),
    [nsLayout, nodes],
  );
  // The full-canvas empty prompt is only for a truly fresh canvas: namespace
  // rectangles are canvas-only frames (never React Flow nodes), so once one
  // exists the prompt must disappear instead of covering the cluster structure
  // the user just created.
  const hasStructureFrames = effectiveLayout.namespaces.length > 0;

  const namespaceOptions = useMemo(() => {
    const discovered = new Set<string>();
    nodes.forEach((node) => {
      if (node.data?.namespace) discovered.add(node.data.namespace);
    });
    nsLayout?.namespaces?.forEach((ns) => discovered.add(ns.name));
    return Array.from(discovered).sort((a, b) => a.localeCompare(b));
  }, [nodes, nsLayout]);

  // Selectable `app` label values, with the real resources they come from:
  // selector fields are dropdowns over the live model, never free text.
  const selectorOptions = useMemo(() => {
    const owners = new Map<string, string[]>();
    nodes.forEach((node) => {
      if (node.data.synthetic) return;
      const kind = node.data.kind;
      let value: string | undefined;
      if (
        kind === "Deployment" ||
        kind === "ReplicaSet" ||
        kind === "Job"
      ) {
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
            node.data.kind === "Deployment" ||
            node.data.kind === "ReplicaSet",
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
  // (Deployments/ReplicaSets/Pods/Jobs/CronJobs). Synthetic nodes are excluded:
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

  // Real VPAs whose spec.targetRef points at the selected workload/Pod:
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
  // [minReplicas, maxReplicas]. Surface that priority right at the input.
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
  // envFrom, env.valueFrom, volumes). Read-only projection of the YAML model.
  const selectedNodeConfigMaps = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (
      kind !== "Pod" &&
      kind !== "Deployment" &&
      kind !== "ReplicaSet" &&
      kind !== "Job" &&
      kind !== "CronJob"
    ) {
      return [];
    }
    return getConfigMapRefDetails(selectedNode.data.resource);
  }, [selectedNode]);

  // Real workloads/Pods that reference the selected ConfigMap by name:
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
  // envFrom, env.valueFrom, volumes). Read-only projection of the YAML model.
  const selectedNodeSecrets = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (
      kind !== "Pod" &&
      kind !== "Deployment" &&
      kind !== "ReplicaSet" &&
      kind !== "Job" &&
      kind !== "CronJob"
    ) {
      return [];
    }
    return getSecretRefDetails(selectedNode.data.resource);
  }, [selectedNode]);

  // Real workloads/Pods that reference the selected Secret by name:
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

  // PVCs referenced by the selected workload/Pod (spec.volumes[].persistentVolumeClaim).
  // Read-only projection of the YAML model.
  const selectedNodePvcs = useMemo(() => {
    if (!selectedNode) return [];
    const kind = selectedNode.data.kind;
    if (
      kind !== "Pod" &&
      kind !== "Deployment" &&
      kind !== "ReplicaSet" &&
      kind !== "Job" &&
      kind !== "CronJob"
    ) {
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
  // storageClassName (a PVC binds to exactly one: volumeName wins over storageClassName).
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
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolume")
      return [];
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

  // Gateways whose spec.gatewayClassName points at the selected GatewayClass:
  // read-only "Used by Gateways" projection.
  const gatewayClassUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "GatewayClass") return [];
    return getGatewaysUsingClass(realResources, selectedNode.data.name).map(
      (r) => ({ kind: r.kind, name: r.metadata.name }),
    );
  }, [selectedNode, realResources]);

  // Routes whose spec.parentRefs[].name points at the selected Gateway:
  // read-only "Used by Routes" projection.
  const gatewayUsedBy = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "Gateway") return [];
    return getRoutesForGateway(realResources, selectedNode.data.name).map(
      (r) => ({ kind: r.kind, name: r.metadata.name }),
    );
  }, [selectedNode, realResources]);

  // Routes whose spec.backendRefs[].name points at the selected Service:
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

  // Controller-managed (synthetic) resources are inspectable but not editable.
  // Like a real cluster, their spec lives on the owning controller.
  const isManaged = !!selectedNode?.data.synthetic;
  const managedOwner = selectedNode?.data.managedBy ?? null;

  return {
    selectedNode,
    selectionKey,
    effectiveLayout,
    hasStructureFrames,
    namespaceOptions,
    selectorOptions,
    serviceOptions,
    workloadOptions,
    vpaTargetOptions,
    vpaScaledBy,
    hpaConstraint,
    selectedNodeConfigMaps,
    configMapUsedBy,
    selectedNodeSecrets,
    secretUsedBy,
    ingressTlsEntries,
    selectedNodePvcs,
    pvcUsedBy,
    pvcBoundTo,
    pvBoundBy,
    storageClassBoundBy,
    pvOptions,
    storageClassOptions,
    gatewayClassOptions,
    gatewayOptions,
    gatewayClassUsedBy,
    gatewayUsedBy,
    serviceRoutedBy,
    relationships,
    resourceYaml,
    inspectorData,
    isManaged,
    managedOwner,
  };
}