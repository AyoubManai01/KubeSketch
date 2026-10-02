import type { SupportedKind } from "../../../types/types";
import type { InspectorProps } from "./inspectorTypes";

/** GatewayClass controller, Gateway class, the read-only Used by projections and the Route sections. */
export function GatewaySections(props: InspectorProps) {
  const { isManaged, draftKind, draftSpec, patchDraft, inspectorData, setSelectedResource, model } = props;
  return (
    <>
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
                  model.gatewayClassUsedBy.length > 0 && (
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
                          {model.gatewayClassUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.gatewayClassUsedBy.map((ref) => (
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

                {/* ── Section: Gateway class ── */}
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
                        <label className="inspector-field__label">Class</label>
                        {(() => {
                          const current = String(
                            draftSpec?.gatewayClassName ?? "",
                          );
                          const known = model.gatewayClassOptions.includes(current);
                          return (
                            <select
                              className="inspector-field__input inspector-field__input--select"
                              value={current}
                              onChange={(e) =>
                                patchDraft({
                                  spec: {
                                    ...draftSpec,
                                    gatewayClassName:
                                      e.target.value || undefined,
                                  },
                                })
                              }
                            >
                              <option value="">(no class)</option>
                              {model.gatewayClassOptions.map((gc) => (
                                <option key={gc} value={gc}>
                                  {gc}
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
                          A Gateway is created from exactly one GatewayClass.
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Section: Used by Routes (Gateway) ── */}
                {inspectorData.kind === "Gateway" &&
                  model.gatewayUsedBy.length > 0 && (
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
                          {model.gatewayUsedBy.length}
                        </span>
                      </div>
                      <div className="inspector-section__body">
                        <div className="inspector-rel-list">
                          {model.gatewayUsedBy.map((ref) => (
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

                {/* ── Section: Routes (parent + backends) ── */}
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
                            const refs: any[] = Array.isArray(
                              draftSpec?.parentRefs,
                            )
                              ? draftSpec.parentRefs
                              : [];
                            const current = String(refs[0]?.name ?? "");
                            const known = model.gatewayOptions.includes(current);
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
                                {model.gatewayOptions.map((gw) => (
                                  <option key={gw} value={gw}>
                                    {gw}
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
                        </div>
                        {draftKind !== "TCPRoute" &&
                          draftKind !== "UDPRoute" && (
                            <div className="inspector-field">
                              <label className="inspector-field__label">
                                Hostnames
                              </label>
                              <input
                                className="inspector-field__input"
                                value={(() => {
                                  const hs: any[] = Array.isArray(
                                    draftSpec?.hostnames,
                                  )
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
                            const refs: any[] = Array.isArray(
                              draftSpec?.backendRefs,
                            )
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
                                  <div
                                    className="inspector-backend-row"
                                    key={i}
                                  >
                                    <select
                                      className="inspector-field__input inspector-field__input--select"
                                      value={String(ref?.name ?? "")}
                                      onChange={(e) => {
                                        const next = [...refs];
                                        next[i] = {
                                          ...next[i],
                                          name: e.target.value,
                                        };
                                        patchRefs(next);
                                      }}
                                    >
                                      <option value="">(pick a Service)</option>
                                      {model.serviceOptions.map((svc) => (
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
                                        patchRefs(
                                          refs.filter((_, j) => j !== i),
                                        )
                                      }
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="inspector-rel-item inspector-rel-item--link"
                                  onClick={() =>
                                    patchRefs([...refs, { name: "" }])
                                  }
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
    </>
  );
}
