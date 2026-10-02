import { toOptionalNumber } from "../inspectorUtils";
import type { InspectorProps } from "./inspectorTypes";

/** Scaling (Deployment/ReplicaSet), Job and Containers (Job) sections. */
export function WorkloadSections(props: InspectorProps) {
  const { isManaged, draft, draftKind, draftSpec, patchDraft, model } = props;
  const { nameDraft } = draft;
  const selectedNode = props.selectedNode;
  const hpaConstraint = model.hpaConstraint;
  const selectorOptions = model.selectorOptions;

  return (
    <>
      {/* ── Section: Scaling (Deployment / ReplicaSet) ── */}
      {!isManaged &&
        (draftKind === "Deployment" || draftKind === "ReplicaSet") && (
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
                <label className="inspector-field__label">Replicas</label>
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
                  Pods are materialized on the canvas to match this count, like
                  a real cluster.
                </span>
                {hpaConstraint && (
                  <span className="inspector-field__hint inspector-field__hint--hpa">
                    HorizontalPodAutoscaler {hpaConstraint.name} has priority:
                    replicas are clamped to {hpaConstraint.min ?? 1} to{" "}
                    {hpaConstraint.max ?? "∞"} and written back to YAML.
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
                    nameDraft.trim() ||
                    (selectedNode.data.name as string);
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
                          {o.value} ({o.owners})
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
                  Pods/ReplicaSets carrying this app label are rendered inside
                  this workload.
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
              <label className="inspector-field__label">Restart Policy</label>
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
              <label className="inspector-field__label">Parallelism</label>
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
                This many Pods are materialized on the canvas, like a real
                cluster.
              </span>
            </div>
            <div className="inspector-field">
              <label className="inspector-field__label">Completions</label>
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
              <label className="inspector-field__label">Container Name</label>
              <input
                className="inspector-field__input"
                value={String(
                  draftSpec?.template?.spec?.containers?.[0]?.name ?? "",
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
                              ...(draftSpec?.template?.spec?.containers?.[0] ??
                                {}),
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
                  draftSpec?.template?.spec?.containers?.[0]?.image ?? "",
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
                              ...(draftSpec?.template?.spec?.containers?.[0] ??
                                {}),
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
    </>
  );
}