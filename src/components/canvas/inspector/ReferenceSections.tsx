import ConfigMapDataEditor from "../../ConfigMapDataEditor";
import type { SupportedKind } from "../../../types/types";
import type { InspectorProps } from "./inspectorTypes";

/** Read-only reference lists (Config Maps/Secrets/PVCs on workloads) and the Data/Used-by sections for ConfigMap and Secret. */
export function ReferenceSections(props: InspectorProps) {
  const { isManaged, draftKind, setDraftResource, selectedNode, inspectorData, setSelectedResource, nodes, model } = props;
  const draft = props.draft.draft;
  return (
    <>
                {/* ── Section: Config Maps (workloads/Pods) ── */}
                {!isManaged &&
                  (inspectorData.kind === "Pod" ||
                    inspectorData.kind === "Deployment" ||
                    inspectorData.kind === "ReplicaSet" ||
                    inspectorData.kind === "Job" ||
                    inspectorData.kind === "CronJob") &&
                  model.selectedNodeConfigMaps.length > 0 && (
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
                          {model.selectedNodeConfigMaps.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.selectedNodeConfigMaps.map((ref) => {
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
                  model.selectedNodeSecrets.length > 0 && (
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
                          {model.selectedNodeSecrets.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.selectedNodeSecrets.map((ref) => {
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
                  model.selectedNodePvcs.length > 0 && (
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
                          {model.selectedNodePvcs.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.selectedNodePvcs.map((ref) => {
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
                        resetToken={model.selectionKey}
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
                  model.configMapUsedBy.length > 0 && (
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
                          {model.configMapUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.configMapUsedBy.map((ref) => (
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
                        resetToken={model.selectionKey}
                        onCommit={(data) =>
                          setDraftResource((prev) => ({
                            ...(prev ?? selectedNode.data.resource),
                            data,
                          }))
                        }
                      />
                      <span className="inspector-field__hint">
                        Plaintext key/value pairs: Kubernetes expects
                        base64-encoded values in spec.data. Values are stored
                        as-is.
                      </span>
                    </div>
                  </div>
                )}

                {/* ── Section: Used by (Secret) ─────────── */}
                {inspectorData.kind === "Secret" && model.secretUsedBy.length > 0 && (
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
                        {model.secretUsedBy.length}
                      </span>
                    </div>
                    <div className="inspector-section__body">
                      <div className="inspector-rel-list">
                        {model.secretUsedBy.map((ref) => (
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
                        Resources referencing this Secret via envFrom /
                        env.valueFrom / volumes in their Pod spec.
                      </span>
                    </div>
                  </div>
                )}
    </>
  );
}
