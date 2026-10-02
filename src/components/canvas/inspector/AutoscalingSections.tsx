import { toOptionalNumber } from "../inspectorUtils";
import type { SupportedKind } from "../../../types/types";
import type { InspectorProps } from "./inspectorTypes";

/** HPA and VPA sections plus the read-only Vertical scaled by projection on their targets. */
export function AutoscalingSections(props: InspectorProps) {
  const { isManaged, draftKind, draftSpec, patchDraft, inspectorData, setSelectedResource, model } = props;
  return (
    <>
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
                          const known = model.workloadOptions.some(
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
                              {model.workloadOptions.map((w) => (
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
                          const known = model.vpaTargetOptions.some(
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
                              {model.vpaTargetOptions.map((w) => (
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
                        Bounds apply to the first containerPolicy (containerName
                        &quot;*&quot;). Clear to leave unbounded.
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
                  model.vpaScaledBy.length > 0 && (
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
                          <path
                            d="M5 12V9M11 8V5M17 4V7"
                            strokeDasharray="2 2"
                          />
                        </svg>
                        Vertical scaled by
                        <span className="inspector-section__count">
                          {model.vpaScaledBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.vpaScaledBy.map((ref) => (
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
                          VPAs whose spec.targetRef points at this resource:
                          they right-size the resource requests of its Pods.
                        </span>
                      </div>
                    </div>
                  )}
    </>
  );
}
