import { useCallback, useMemo, useState } from "react";
import { type Node } from "@xyflow/react";
import {
  cronParallelismOf,
  isSingleNodeAccessMode,
  nodeIdFor,
  parallelismOf,
  replicasOf,
  type K8sNodeData,
} from "../../utils/buildGraph";
import { apiVersionForKind, useVeltraStore } from "../../store/store";
import { isClusterScoped } from "../../utils/k8sScope";
import type { K8sResource, SupportedKind } from "../../types/types";
import {
  keyValueError,
  parseKeyValueString,
  toKeyValueString,
} from "./inspectorUtils";

export interface InspectorDraft {
  draftResource: K8sResource | null;
  setDraftResource: React.Dispatch<React.SetStateAction<K8sResource | null>>;
  labelsDraft: string;
  setLabelsDraft: (v: string) => void;
  annotationsDraft: string;
  setAnnotationsDraft: (v: string) => void;
  nameDraft: string;
  setNameDraft: (v: string) => void;
  draftErrors: { labels?: string; annotations?: string };
  setDraftErrors: React.Dispatch<
    React.SetStateAction<{ labels?: string; annotations?: string }>
  >;
  draft: K8sResource | null;
  draftKind: SupportedKind;
  draftSpec: Record<string, any>;
  draftMetadata: Record<string, any>;
  pvcAccessModeViolation: string | null;
  nameError: string;
  namespaceHint: string;
  dirty: boolean;
  patchDraft: (patch: {
    kind?: SupportedKind;
    apiVersion?: string;
    metadata?: Record<string, unknown>;
    spec?: Record<string, unknown>;
    data?: Record<string, string> | undefined;
  }) => void;
  handleValidate: () => void;
}

/**
 * The inspector's edit buffer: every field edits a local draft instead of the
 * store; the draft is committed to the model (and YAML) only when the user
 * presses "Validate". This lets labels/annotations accept partial input while
 * typing instead of round-tripping every keystroke through a lossy parser.
 */
export function useInspectorDraft(
  selectedNode: Node<K8sNodeData> | null,
  selectionKey: string,
  isManaged: boolean,
  pvcUsedBy: Array<{ kind: string; name: string }>,
  nodes: Node<K8sNodeData>[],
): InspectorDraft {
  const updateNodeFromCanvas = useVeltraStore((s) => s.updateNodeFromCanvas);
  const updateNodeResourceFromCanvas = useVeltraStore(
    (s) => s.updateNodeResourceFromCanvas,
  );

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
    resourceSig: string;
    labels: string;
    annotations: string;
    name: string;
  }>({
    selectionKey: "",
    resourceSig: "",
    labels: "",
    annotations: "",
    name: "",
  });

  const committedResource = selectedNode?.data.resource ?? null;
  const draft = draftResource ?? committedResource;
  const draftKind = (draft?.kind ?? "") as SupportedKind;
  const draftSpec = (draft?.spec ?? {}) as Record<string, any>;
  const draftMetadata = (draft?.metadata ?? {}) as Record<string, any>;

  // Single-node access-mode guard: a PVC mounted by a multi-replica workload
  // can't be RWO/RWOP, because identical Pods would all claim the same volume, and only
  // one node may attach it. Surfaced inline on the Access Modes field and blocks
  // the commit (mirrors the create-modal and drag interceptor).
  const pvcAccessModeViolation = useMemo(() => {
    if (!selectedNode || selectedNode.data.kind !== "PersistentVolumeClaim") {
      return null;
    }
    const current = draftResource ?? selectedNode.data.resource;
    if (!current || !isSingleNodeAccessMode(current as K8sResource))
      return null;
    const draftMode = String(
      (current.spec as Record<string, any> | undefined)?.accessModes?.[0] ??
        "ReadWriteOnce",
    );
    const offender = pvcUsedBy.find((ref) => {
      if (ref.kind === "Job") {
        const node = nodes.find(
          (n) =>
            !n.data.synthetic &&
            n.data.kind === ref.kind &&
            n.data.name === ref.name,
        );
        return node ? parallelismOf(node.data.resource) > 1 : false;
      }
      if (ref.kind === "CronJob") {
        const node = nodes.find(
          (n) =>
            !n.data.synthetic &&
            n.data.kind === ref.kind &&
            n.data.name === ref.name,
        );
        return node ? cronParallelismOf(node.data.resource) > 1 : false;
      }
      if (
        ref.kind !== "Deployment" &&
        ref.kind !== "ReplicaSet"
      )
        return false;
      const node = nodes.find(
        (n) =>
          !n.data.synthetic &&
          n.data.kind === ref.kind &&
          n.data.name === ref.name,
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

  // A missing namespace falls back to "default" at commit time, exactly like
  // the rest of the model: the canvas already treats a namespaced resource
  // without an explicit namespace as living in "default" and writes it back on
  // serialization. Empty is therefore a valid draft state — surface it as a
  // hint instead of blocking validation.
  const namespaceHint =
    draftResource && !isClusterScoped(draftKind)
      ? String(draftMetadata.namespace ?? "").trim()
        ? ""
        : "Leave empty to use the default namespace."
      : "";

  // True when the draft holds anything the model doesn't, which gates the
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
  // or file-editor edits, HorizontalPodAutoscaler replica clamps). "Pending
  // edits" is measured against the LAST-SEEDED snapshot, not the current
  // committed resource: the committed resource legitimately differs after any
  // external change, and comparing against it would block every re-seed and
  // leave the inspector showing stale values. In-progress typing is still
  // never clobbered (the user's Validate wins, last-writer-wins).
  if (selectedNode && !isManaged) {
    const committed = selectedNode.data.resource;
    const committedSnapshotChanged =
      JSON.stringify(committed) !== lastDraftSig.resourceSig ||
      toKeyValueString(committed.metadata?.labels) !== lastDraftSig.labels ||
      toKeyValueString(
        committed.metadata?.annotations as Record<string, string> | undefined,
      ) !== lastDraftSig.annotations ||
      (committed.metadata?.name ?? "") !== lastDraftSig.name;
    const hasPendingEdits =
      draftResource !== null &&
      (JSON.stringify(draftResource) !== lastDraftSig.resourceSig ||
        labelsDraft !== lastDraftSig.labels ||
        annotationsDraft !== lastDraftSig.annotations ||
        nameDraft !== lastDraftSig.name);
    const needsInit =
      draftResource === null ||
      lastDraftSig.selectionKey !== selectionKey ||
      (committedSnapshotChanged && !hasPendingEdits);
    if (needsInit) {
      setLastDraftSig({
        selectionKey,
        resourceSig: JSON.stringify(selectedNode.data.resource),
        labels: toKeyValueString(selectedNode.data.resource.metadata?.labels),
        annotations: toKeyValueString(
          selectedNode.data.resource.metadata?.annotations as
            | Record<string, string>
            | undefined,
        ),
        name: selectedNode.data.resource.metadata?.name ?? "",
      });
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
    setLastDraftSig({
      selectionKey: freshKey,
      resourceSig: JSON.stringify(resource),
      labels: toKeyValueString(resource.metadata?.labels),
      annotations: toKeyValueString(
        resource.metadata?.annotations as Record<string, string> | undefined,
      ),
      name: resource.metadata?.name ?? "",
    });
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

    // Empty/duplicate names are surfaced inline on the Name field: block the
    // commit so the model is never left invalid (invariant 8).
    if (validateDraftName(kind, name)) return;

    // Single-node access-mode guard (invariant 14): a RWO/RWOP claim mounted by
    // a multi-replica workload is impossible. The inline error explains why.
    if (pvcAccessModeViolation) return;

    // The final resource: raw string drafts parsed into the structured model.
    const metadata: K8sResource["metadata"] = {
      ...(draftResource.metadata ?? {}),
      name,
      labels: parseKeyValueString(labelsDraft),
      annotations: parseKeyValueString(annotationsDraft),
    };
    // A namespaced resource without an explicit namespace lives in "default",
    // matching the canvas model (which also writes it back on serialization).
    if (isClusterScoped(kind)) {
      delete metadata.namespace;
    } else if (!String(metadata.namespace ?? "").trim()) {
      metadata.namespace = "default";
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
  }, [
    selectedNode,
    draftResource,
    labelsDraft,
    annotationsDraft,
    nameDraft,
    isManaged,
    pvcAccessModeViolation,
  ]);

  return {
    draftResource,
    setDraftResource,
    labelsDraft,
    setLabelsDraft,
    annotationsDraft,
    setAnnotationsDraft,
    nameDraft,
    setNameDraft,
    draftErrors,
    setDraftErrors,
    draft,
    draftKind,
    draftSpec,
    draftMetadata,
    pvcAccessModeViolation,
    nameError,
    namespaceHint,
    dirty,
    patchDraft,
    handleValidate,
  };
}