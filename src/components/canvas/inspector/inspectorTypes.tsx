import { type Node } from "@xyflow/react";
import type { K8sNodeData } from "../../../utils/buildGraph";
import type { K8sResource, SupportedKind } from "../../../types/types";
import type { CanvasModel } from "../useCanvasModel";
import type { InspectorDraft } from "../useInspectorDraft";

/** Everything the inspector sections render from: the selection model, the
 *  draft buffer and the few store actions they call directly. */
export interface InspectorProps {
  selectedNode: Node<K8sNodeData>;
  inspectorData: NonNullable<CanvasModel["inspectorData"]>;
  isManaged: boolean;
  managedOwner: CanvasModel["managedOwner"];
  setSelectedResource: (r: { kind: SupportedKind; name: string } | null) => void;
  namespaceListId: string;
  model: CanvasModel;
  draft: InspectorDraft;
  draftKind: InspectorDraft["draftKind"];
  draftSpec: InspectorDraft["draftSpec"];
  draftMetadata: InspectorDraft["draftMetadata"];
  nodes: Node<K8sNodeData>[];
  patchDraft: InspectorDraft["patchDraft"];
  setDraftResource: InspectorDraft["setDraftResource"];
  draftResource: K8sResource | null;
  nameDraft: string;
  setNameDraft: (v: string) => void;
  nameError: string;
  namespaceError: string;
  labelsDraft: string;
  setLabelsDraft: (v: string) => void;
  annotationsDraft: string;
  setAnnotationsDraft: (v: string) => void;
  draftErrors: { labels?: string; annotations?: string };
  setDraftErrors: React.Dispatch<
    React.SetStateAction<{ labels?: string; annotations?: string }>
  >;
  yamlPreviewOpen: boolean;
  setYamlPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  dirty: boolean;
  handleValidate: () => void;
  deleteNodeFromCanvas: (id: string) => void;
}

/** Controlled name editor for the inspector. The value is a local draft owned by
 *  the inspector; nothing is committed until "Validate Changes" is pressed, so
 *  partial input is never round-tripped through the model. */
export function NameField({
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