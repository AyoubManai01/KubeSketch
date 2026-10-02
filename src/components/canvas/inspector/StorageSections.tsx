import type { SupportedKind } from "../../../types/types";
import type { InspectorProps } from "./inspectorTypes";

/** PVC, PV and StorageClass sections: storage binding fields and the read-only Bound/Mounted projections. */
export function StorageSections(props: InspectorProps) {
  const { isManaged, draftKind, draftSpec, patchDraft, inspectorData, setSelectedResource, model } = props;
  const draft = props.draft;
  return (
    <>
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
                            draft.pvcAccessModeViolation
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
                        {draft.pvcAccessModeViolation && (
                          <span className="inspector-field__error">
                            {draft.pvcAccessModeViolation}
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
                          const known = model.storageClassOptions.includes(current);
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
                                (unbound, no storageClassName)
                              </option>
                              {model.storageClassOptions.map((sc) => (
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
                          Setting this clears spec.volumeName: a PVC binds to
                          exactly one of PV or StorageClass.
                        </span>
                      </div>
                      <div className="inspector-field">
                        <label className="inspector-field__label">
                          Bind to PV
                        </label>
                        {(() => {
                          const current = String(draftSpec?.volumeName ?? "");
                          const known = model.pvOptions.includes(current);
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
                                (no volumeName, unbound or via StorageClass)
                              </option>
                              {model.pvOptions.map((pv) => (
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
                      {model.pvcBoundTo && (
                        <div className="inspector-static-row">
                          <span className="inspector-static-row__key">
                            Bound to
                          </span>
                          <span
                            className="inspector-static-row__val"
                            title={model.pvcBoundTo.name}
                          >
                            {model.pvcBoundTo.kind === "PersistentVolume"
                              ? "PV"
                              : "StorageClass"}{" "}
                            {model.pvcBoundTo.name}
                            {!model.pvcBoundTo.exists ? " (missing)" : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Section: Mounted by (PersistentVolumeClaim) ── */}
                {inspectorData.kind === "PersistentVolumeClaim" &&
                  model.pvcUsedBy.length > 0 && (
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
                          {model.pvcUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.pvcUsedBy.map((ref) => (
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
                          Resources claiming this PVC via spec.volumes[].
                          persistentVolumeClaim.
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
                        <label className="inspector-field__label">
                          Capacity
                        </label>
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
                            draftSpec?.persistentVolumeReclaimPolicy ??
                              "Retain",
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
                  model.pvBoundBy.length > 0 && (
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
                          {model.pvBoundBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.pvBoundBy.map((pvcName) => (
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
                  model.storageClassBoundBy.length > 0 && (
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
                          {model.storageClassBoundBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.storageClassBoundBy.map((pvcName) => (
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
    </>
  );
}
