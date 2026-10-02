import { apiVersionForKind } from "../../../store/store";
import { isClusterScoped } from "../../../utils/k8sScope";
import { SUPPORTED_KINDS, type SupportedKind } from "../../../types/types";
import type { CanvasModel } from "../useCanvasModel";
import type { InspectorDraft } from "../useInspectorDraft";
import { NameField, type InspectorProps } from "./inspectorTypes";
import { WorkloadSections } from "./WorkloadSections";
import { CronJobSections } from "./CronJobSections";
import { ReferenceSections } from "./ReferenceSections";
import { StorageSections } from "./StorageSections";
import { NetworkSections } from "./NetworkSections";
import { AutoscalingSections } from "./AutoscalingSections";
import { GatewaySections } from "./GatewaySections";
import { RelationshipsSection } from "./RelationshipsSection";

interface Props {
  selectedNode: InspectorProps["selectedNode"] | null;
  inspectorData: NonNullable<CanvasModel["inspectorData"]> | null;
  isManaged: boolean;
  managedOwner: CanvasModel["managedOwner"];
  setSelectedResource: InspectorProps["setSelectedResource"];
  namespaceListId: string;
  model: CanvasModel;
  draft: InspectorDraft;
  nodes: InspectorProps["nodes"];
  dirty: boolean;
  handleValidate: () => void;
  deleteNodeFromCanvas: (id: string) => void;
  yamlPreviewOpen: boolean;
  setYamlPreviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  inspectorContentRef: React.RefObject<HTMLDivElement | null>;
}

/** The resource inspector drawer: hero, managed banner, General/Metadata,
 *  the kind-specific sections, YAML preview and the Validate/Delete footer. */
export function Inspector(props: Props) {
  const {
    selectedNode,
    inspectorData,
    isManaged,
    managedOwner,
    setSelectedResource,
    namespaceListId,
    model,
    draft,
    nodes,
    dirty,
    handleValidate,
    deleteNodeFromCanvas,
    yamlPreviewOpen,
    setYamlPreviewOpen,
    inspectorContentRef,
  } = props;

  const sectionProps = (
    sel: NonNullable<InspectorProps["selectedNode"]>,
    data: NonNullable<InspectorProps["inspectorData"]>,
  ): InspectorProps => ({
    selectedNode: sel,
    inspectorData: data,
    isManaged,
    managedOwner,
    setSelectedResource,
    namespaceListId,
    model,
    draft,
    draftKind: draft.draftKind,
    draftSpec: draft.draftSpec,
    draftMetadata: draft.draftMetadata,
    nodes,
    patchDraft: draft.patchDraft,
    setDraftResource: draft.setDraftResource,
    draftResource: draft.draftResource,
    nameDraft: draft.nameDraft,
    setNameDraft: draft.setNameDraft,
    nameError: draft.nameError,
    namespaceError: draft.namespaceError,
    labelsDraft: draft.labelsDraft,
    setLabelsDraft: draft.setLabelsDraft,
    annotationsDraft: draft.annotationsDraft,
    setAnnotationsDraft: draft.setAnnotationsDraft,
    draftErrors: draft.draftErrors,
    setDraftErrors: draft.setDraftErrors,
    yamlPreviewOpen,
    setYamlPreviewOpen,
    dirty,
    handleValidate,
    deleteNodeFromCanvas,
  });

  return (
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
          Select a resource on the canvas to inspect and edit its properties.
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
                backgroundColor: hexToRgbaLocal(inspectorData.color, 0.12),
                borderColor: hexToRgbaLocal(inspectorData.color, 0.28),
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
                    backgroundColor: hexToRgbaLocal(inspectorData.color, 0.15),
                    color: inspectorData.color,
                    borderColor: hexToRgbaLocal(inspectorData.color, 0.3),
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
              <div className="inspector-hero__name" title={inspectorData.name}>
                {inspectorData.name}
              </div>
              {inspectorData.namespace &&
                !isClusterScoped(inspectorData.kind) && (
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
                  Kubernetes creates this {inspectorData.kind} automatically:
                  it is not part of the manifest. Edit the owner to change it;
                  scale its replicas to change the Pod count.
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
                            <span key={k} className="inspector-label-chip">
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
                    value={draft.draftKind}
                    onChange={(e) => {
                      const next = e.target.value as SupportedKind;
                      draft.setDraftResource((prev) => {
                        const base = prev ?? selectedNode.data.resource;
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
                  value={draft.nameDraft}
                  error={draft.nameError}
                  onChange={draft.setNameDraft}
                />
                {!isClusterScoped(draft.draftKind) && (
                  <div className="inspector-field">
                    <label className="inspector-field__label">Namespace</label>
                    <input
                      className={`inspector-field__input${draft.namespaceError ? " inspector-field__input--invalid" : ""}`}
                      value={(draft.draftMetadata.namespace as string) ?? ""}
                      list={namespaceListId}
                      onChange={(e) =>
                        draft.patchDraft({
                          metadata: {
                            namespace: e.target.value || undefined,
                          },
                        })
                      }
                      placeholder="choose or type a namespace"
                    />
                    {draft.namespaceError && (
                      <span className="inspector-field__error">
                        {draft.namespaceError}
                      </span>
                    )}
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
                      draft.draftErrors.labels
                        ? "inspector-field__input--invalid"
                        : ""
                    }`}
                    value={draft.labelsDraft}
                    onChange={(e) => {
                      draft.setLabelsDraft(e.target.value);
                      draft.setDraftErrors((prev) => ({
                        ...prev,
                        labels: undefined,
                      }));
                    }}
                    placeholder="app=my-app,tier=frontend"
                  />
                  {draft.draftErrors.labels && (
                    <span className="inspector-field__error">
                      {draft.draftErrors.labels}
                    </span>
                  )}
                  {(() => {
                    const parsed = parseKeyValueStringLocal(draft.labelsDraft);
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
                  <label className="inspector-field__label">Annotations</label>
                  <input
                    className={`inspector-field__input ${
                      draft.draftErrors.annotations
                        ? "inspector-field__input--invalid"
                        : ""
                    }`}
                    value={draft.annotationsDraft}
                    onChange={(e) => {
                      draft.setAnnotationsDraft(e.target.value);
                      draft.setDraftErrors((prev) => ({
                        ...prev,
                        annotations: undefined,
                      }));
                    }}
                    placeholder="owner=team-a"
                  />
                  {draft.draftErrors.annotations && (
                    <span className="inspector-field__error">
                      {draft.draftErrors.annotations}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Kind-specific sections */}
          <WorkloadSections {...sectionProps(selectedNode, inspectorData)} />
          <CronJobSections {...sectionProps(selectedNode, inspectorData)} />
          <ReferenceSections {...sectionProps(selectedNode, inspectorData)} />
          <StorageSections {...sectionProps(selectedNode, inspectorData)} />
          <NetworkSections {...sectionProps(selectedNode, inspectorData)} />
          <AutoscalingSections {...sectionProps(selectedNode, inspectorData)} />
          <GatewaySections {...sectionProps(selectedNode, inspectorData)} />
          <RelationshipsSection {...sectionProps(selectedNode, inspectorData)} />

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
            {yamlPreviewOpen && model.resourceYaml && (
              <>
                <pre className="inspector-yaml-preview">
                  {model.resourceYaml}
                </pre>
                {isManaged && (
                  <span className="inspector-field__hint inspector-field__hint--pad">
                    Effective state generated by the controller, not part of
                    the manifest.
                  </span>
                )}
              </>
            )}
          </div>

          {/* ── Footer: Validate + Delete ───────────── */}
          {isManaged ? (
            <div className="inspector-footer">
              <span className="inspector-footer__hint">
                Managed resources can't be deleted directly: Kubernetes would
                recreate them. Delete the owner or lower its replicas.
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
                  Changes are applied to the resource (and YAML) when you press
                  Validate Changes.
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
          {model.namespaceOptions.map((ns) => (
            <option key={ns} value={ns} />
          ))}
        </datalist>
      )}
    </aside>
  );
}

/** Local hex tint helper (same behavior as kindMeta's hexToRgba). */
function hexToRgbaLocal(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(139,148,158,${alpha})`;
  return `rgba(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)},${alpha})`;
}

function parseKeyValueStringLocal(
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