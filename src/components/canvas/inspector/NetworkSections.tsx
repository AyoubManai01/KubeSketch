import { toOptionalNumber } from "../inspectorUtils";
import type { SupportedKind } from "../../../types/types";
import type { InspectorProps } from "./inspectorTypes";

/** Service networking, Ingress routing/TLS and the Routed by (Service) projection. */
export function NetworkSections(props: InspectorProps) {
const { isManaged, draftKind, draftSpec, patchDraft, selectedNode, inspectorData, setSelectedResource, nodes, model } = props;
  const SERVICE_TYPES = ["ClusterIP", "NodePort", "LoadBalancer", "ExternalName"];
  return (
    <>
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
                          const known = model.selectorOptions.some(
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
                              {model.selectorOptions.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.value} ({o.owners})
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
                          {model.serviceOptions.map((svc) => (
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
                              !model.serviceOptions.includes(current) ? (
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
                      {model.ingressTlsEntries.length > 0 && (
                        <span className="inspector-section__count">
                          {model.ingressTlsEntries.length}
                        </span>
                      )}
                    </div>
                    <div className="inspector-section__body">
                      {model.ingressTlsEntries.length === 0 && (
                        <span className="inspector-field__hint">
                          No spec.tls[] entries. Drag an Ingress onto a Secret
                          to terminate TLS, or edit the YAML.
                        </span>
                      )}
                      {model.ingressTlsEntries.map((entry, idx) => {
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
                              TLS #{idx + 1}: Secret
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

                {/* ── Section: Routed by (Service) ── */}
                {inspectorData.kind === "Service" &&
                  model.serviceRoutedBy.length > 0 && (
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
                          {model.serviceRoutedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.serviceRoutedBy.map((ref) => (
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
                          Gateway API routes whose spec.backendRefs point at
                          this Service.
                        </span>
                      </div>
                    </div>
                  )}
    </>
  );
}
