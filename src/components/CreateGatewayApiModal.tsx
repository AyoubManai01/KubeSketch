import { useMemo, useRef, useState } from 'react';
import type { K8sResource } from '../types/types';
import { useVeltraStore } from '../store/store';
import NamespaceField from './NamespaceField';
import NamespaceModal from './NamespaceModal';
import { KIND_COLORS, hexToRgba } from './kindMeta';

interface Props {
    onClose: () => void;
}

type RouteKind = 'HTTPRoute' | 'GRPCRoute' | 'TCPRoute' | 'TLSRoute' | 'UDPRoute';

const ROUTE_KINDS: RouteKind[] = ['HTTPRoute', 'GRPCRoute', 'TCPRoute', 'TLSRoute', 'UDPRoute'];

/** Route kinds that carry spec.hostnames (TCPRoute and UDPRoute have none). */
const ROUTES_WITH_HOSTNAMES: RouteKind[] = ['HTTPRoute', 'GRPCRoute', 'TLSRoute'];

interface RouteBackend {
    id: number;
    mode: 'existing' | 'new';
    service: string;
    newServiceName: string;
    newServicePort: string;
}

interface RouteDraft {
    id: number;
    kind: RouteKind;
    name: string;
    hostnames: string;
    backends: RouteBackend[];
}

function suggestedRouteName(kind: RouteKind, existing: string[]): string {
    const base = kind.toLowerCase();
    let idx = 1;
    while (existing.includes(`${base}-${idx}`)) idx++;
    return `${base}-${idx}`;
}

export default function CreateGatewayApiModal({ onClose }: Props) {
    const nodes = useVeltraStore((s) => s.nodes);
    const addConfiguredNodes = useVeltraStore((s) => s.addConfiguredNodes);
    const nsLayout = useVeltraStore((s) => s.nsLayout);
    const firstInputRef = useRef<HTMLInputElement>(null);
    const idCounter = useRef(1);

    const suggestedGatewayClassName = useMemo(() => {
        let idx = 1;
        while (nodes.some((n) => n.data.kind === 'GatewayClass' && n.data.name === `gatewayclass-${idx}`)) idx++;
        return `gatewayclass-${idx}`;
    }, [nodes]);

    const suggestedGatewayName = useMemo(() => {
        let idx = 1;
        while (nodes.some((n) => n.data.kind === 'Gateway' && n.data.name === `gateway-${idx}`)) idx++;
        return `gateway-${idx}`;
    }, [nodes]);

    const serviceOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'Service')
                .map((n) => n.data.name as string)
                .sort((a, b) => a.localeCompare(b)),
        [nodes]
    );

    const namespaceOptions = useMemo(() => {
        const vals = new Set<string>();
        nodes.forEach((n) => {
            if (n.data.namespace) vals.add(n.data.namespace);
        });
        nsLayout?.namespaces?.forEach((ns) => vals.add(ns.name));
        return Array.from(vals).sort();
    }, [nodes, nsLayout]);

    const [gcName, setGcName] = useState(suggestedGatewayClassName);
    const [gcControllerName, setGcControllerName] = useState('acme.io/gateway-controller');
    const [gwName, setGwName] = useState(suggestedGatewayName);
    const [gwNamespace, setGwNamespace] = useState('default');
    // Stacked "+ New namespace" prompt (alternative to typing a new name).
    const [nsCreateOpen, setNsCreateOpen] = useState(false);

    // The Gateway, its Routes and any new Services are namespaced, so the
    // namespace must be picked, typed or created explicitly.
    const namespaceError = useMemo(
        () => (gwNamespace.trim() ? '' : 'Choose or create a namespace.'),
        [gwNamespace]
    );

    const [routes, setRoutes] = useState<RouteDraft[]>(() => [
        {
            id: 0,
            kind: 'HTTPRoute',
            name: 'httproute-1',
            hostnames: '',
            backends: [],
        },
    ]);

    const patchRoute = (routeId: number, patch: Partial<RouteDraft>) => {
        setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, ...patch } : r)));
    };

    const patchBackend = (routeId: number, backendId: number, patch: Partial<RouteBackend>) => {
        setRoutes((prev) =>
            prev.map((r) =>
                r.id === routeId
                    ? {
                          ...r,
                          backends: r.backends.map((b) =>
                              b.id === backendId ? { ...b, ...patch } : b
                          ),
                      }
                    : r
            )
        );
    };

    const addRoute = () => {
        setRoutes((prev) => {
            const existingNames = prev.map((r) => r.name);
            const kind: RouteKind = 'HTTPRoute';
            return [
                ...prev,
                {
                    id: idCounter.current++,
                    kind,
                    name: suggestedRouteName(kind, existingNames),
                    hostnames: '',
                    backends: [],
                },
            ];
        });
    };

    const removeRoute = (routeId: number) => {
        setRoutes((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== routeId) : prev));
    };

    const addBackend = (routeId: number) => {
        setRoutes((prev) =>
            prev.map((r) =>
                r.id === routeId
                    ? {
                          ...r,
                          backends: [
                              ...r.backends,
                              {
                                  id: idCounter.current++,
                                  mode: serviceOptions.length > 0 ? 'existing' : 'new',
                                  service: '',
                                  newServiceName: '',
                                  newServicePort: '80',
                              },
                          ],
                      }
                    : r
            )
        );
    };

    const removeBackend = (routeId: number, backendId: number) => {
        setRoutes((prev) =>
            prev.map((r) =>
                r.id === routeId
                    ? { ...r, backends: r.backends.filter((b) => b.id !== backendId) }
                    : r
            )
        );
    };

    const gcNameError = useMemo(() => {
        const trimmed = gcName.trim();
        if (!trimmed) return 'A GatewayClass name is required.';
        return nodes.some((n) => n.data.kind === 'GatewayClass' && n.data.name === trimmed)
            ? `A GatewayClass named “${trimmed}” already exists.`
            : '';
    }, [gcName, nodes]);

    const gwNameError = useMemo(() => {
        const trimmed = gwName.trim();
        if (!trimmed) return 'A Gateway name is required.';
        return nodes.some((n) => n.data.kind === 'Gateway' && n.data.name === trimmed)
            ? `A Gateway named “${trimmed}” already exists.`
            : '';
    }, [gwName, nodes]);

    interface RouteError {
        nameError: string;
        backendErrors: string[];
    }

    const routeErrors = useMemo(() => {
        const seenNames = new Map<string, string>(); // "Kind:name" -> route label
        return routes.map((route): RouteError => {
            const nameError = (() => {
                const trimmed = route.name.trim();
                if (!trimmed) return 'A Route name is required.';
                const key = `${route.kind}:${trimmed}`;
                if (seenNames.has(key)) return `Another route in this modal is already named “${trimmed}”.`;
                seenNames.set(key, trimmed);
                return nodes.some((n) => n.data.kind === route.kind && n.data.name === trimmed)
                    ? `A ${route.kind} named “${trimmed}” already exists.`
                    : '';
            })();
            const backendErrors = route.backends.map((backend) => {
                if (backend.mode === 'existing') {
                    return backend.service ? '' : 'Pick an existing Service or create a new one.';
                }
                const name = backend.newServiceName.trim();
                if (!name) return 'The new Service needs a name.';
                if (nodes.some((n) => n.data.kind === 'Service' && n.data.name === name)) {
                    return `A Service named “${name}” already exists.`;
                }
                const port = Number(backend.newServicePort);
                if (!Number.isFinite(port) || port < 1 || port > 65535) {
                    return 'The port must be a number between 1 and 65535.';
                }
                return '';
            });
            return { nameError, backendErrors };
        });
    }, [routes, nodes]);

    const hasErrors = routeErrors.some(
        (r) => r.nameError || r.backendErrors.some((e) => e)
    );

    function handleCreate() {
        if (gcNameError || gwNameError || namespaceError || hasErrors) return;
        const gatewayClass = gcName.trim() || suggestedGatewayClassName;
        const gateway = gwName.trim() || suggestedGatewayName;
        const resources: K8sResource[] = [];

        resources.push({
            apiVersion: 'gateway.networking.k8s.io/v1',
            kind: 'GatewayClass',
            metadata: { name: gatewayClass },
            spec: { controllerName: gcControllerName.trim() || 'acme.io/gateway-controller' },
        });

        resources.push({
            apiVersion: 'gateway.networking.k8s.io/v1',
            kind: 'Gateway',
            metadata: { name: gateway, namespace: gwNamespace.trim() },
            spec: { gatewayClassName: gatewayClass, listeners: [] },
        });

        routes.forEach((route) => {
            const hostnames = route.hostnames
                .split(/[\s,]+/)
                .map((h) => h.trim())
                .filter(Boolean);
            const backendRefs = route.backends.map((backend) => {
                if (backend.mode === 'existing') {
                    return { name: backend.service };
                }
                return {
                    name: backend.newServiceName.trim(),
                    port: Number(backend.newServicePort),
                };
            });
            const spec: Record<string, unknown> = {
                parentRefs: [{ name: gateway, namespace: gwNamespace.trim() }],
            };
            if (ROUTES_WITH_HOSTNAMES.includes(route.kind) && hostnames.length > 0) {
                spec.hostnames = hostnames;
            }
            if (backendRefs.length > 0) {
                spec.backendRefs = backendRefs;
            }
            resources.push({
                apiVersion: 'gateway.networking.k8s.io/v1',
                kind: route.kind,
                metadata: { name: route.name.trim(), namespace: gwNamespace.trim() },
                spec,
            });
        });

        routes.forEach((route) => {
            route.backends.forEach((backend) => {
                if (backend.mode !== 'new') return;
                const port = Number(backend.newServicePort);
                resources.push({
                    apiVersion: 'v1',
                    kind: 'Service',
                    metadata: { name: backend.newServiceName.trim(), namespace: gwNamespace.trim() },
                    spec: {
                        type: 'ClusterIP',
                        ports: [
                            {
                                port: Number.isFinite(port) ? port : 80,
                                targetPort: Number.isFinite(port) ? port : 80,
                            },
                        ],
                    },
                });
            });
        });

        addConfiguredNodes(resources, { kind: 'Gateway', name: gateway });
        onClose();
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal--gateway-api" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <div
                        className="modal-header__icon"
                        style={{
                            backgroundColor: hexToRgba(KIND_COLORS.Gateway, 0.13, '244,63,94'),
                            border: `1px solid ${hexToRgba(KIND_COLORS.Gateway, 0.28, '244,63,94')}`,
                            color: KIND_COLORS.Gateway,
                        }}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                            <path d="M3 7h18v10H3z" />
                            <path d="M8 10h4v4H8z" />
                            <path d="M14.5 10h2.5v4h-2.5" />
                        </svg>
                    </div>
                    <span className="modal-header__title">Create Gateway API</span>
                    <button type="button" className="modal-header__close" onClick={onClose} title="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                <div className="modal-body">
                    {/* ── GatewayClass (cluster-scoped) ── */}
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">
                                GatewayClass name
                                <span className="modal-field__hint">
                                    Cluster-scoped: it sits outside any namespace.
                                </span>
                            </label>
                            <input
                                ref={firstInputRef}
                                className={`modal-field__input ${gcNameError ? 'modal-field__input--invalid' : ''}`}
                                value={gcName}
                                onChange={(e) => setGcName(e.target.value)}
                                placeholder={suggestedGatewayClassName}
                            />
                            {gcNameError && <span className="modal-field__error">{gcNameError}</span>}
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Controller name
                                <span className="modal-field__hint">
                                    spec.controllerName: the controller that reconciles Gateways of this class.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={gcControllerName}
                                onChange={(e) => setGcControllerName(e.target.value)}
                                placeholder="acme.io/gateway-controller"
                            />
                        </div>
                    </div>

                    {/* ── Gateway (namespaced) ── */}
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Gateway name
                                <span className="modal-field__hint">
                                    Created from the GatewayClass above (spec.gatewayClassName).
                                </span>
                            </label>
                            <input
                                className={`modal-field__input ${gwNameError ? 'modal-field__input--invalid' : ''}`}
                                value={gwName}
                                onChange={(e) => setGwName(e.target.value)}
                                placeholder={suggestedGatewayName}
                            />
                            {gwNameError && <span className="modal-field__error">{gwNameError}</span>}
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Namespace</label>
                            <div className="namespace-field-group">
                                <NamespaceField
                                    value={gwNamespace}
                                    onChange={setGwNamespace}
                                    options={namespaceOptions}
                                />
                                <button
                                    type="button"
                                    className="namespace-field__new"
                                    onClick={() => setNsCreateOpen(true)}
                                    title="Create a new namespace rectangle"
                                >
                                    + New
                                </button>
                            </div>
                            {namespaceError && (
                                <span className="modal-field__error">{namespaceError}</span>
                            )}
                        </div>
                    </div>

                    {/* ── Routes ── */}
                    <div className="modal-field">
                        <label className="modal-field__label">
                            Routes
                            <span className="modal-field__hint">
                                Attached to the Gateway via spec.parentRefs; each routes to Services via spec.backendRefs.
                            </span>
                        </label>
                    </div>
                    {routes.map((route, routeIndex) => {
                        const error = routeErrors[routeIndex];
                        return (
                            <div className="gateway-route-card" key={route.id}>
                                <div className="gateway-route-card__header">
                                    <span className="gateway-route-card__title">Route {routeIndex + 1}</span>
                                    <button
                                        type="button"
                                        className="modal-header__close"
                                        onClick={() => removeRoute(route.id)}
                                        title="Remove route"
                                        disabled={routes.length <= 1}
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    </button>
                                </div>
                                <div className="modal-row">
                                    <div className="modal-field">
                                        <label className="modal-field__label">Route type</label>
                                        <select
                                            className="modal-field__input modal-field__input--select"
                                            value={route.kind}
                                            onChange={(e) =>
                                                patchRoute(route.id, { kind: e.target.value as RouteKind })
                                            }
                                        >
                                            {ROUTE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                                        </select>
                                    </div>
                                    <div className="modal-field">
                                        <label className="modal-field__label">Name</label>
                                        <input
                                            className={`modal-field__input ${error?.nameError ? 'modal-field__input--invalid' : ''}`}
                                            value={route.name}
                                            onChange={(e) => patchRoute(route.id, { name: e.target.value })}
                                        />
                                        {error?.nameError && (
                                            <span className="modal-field__error">{error.nameError}</span>
                                        )}
                                    </div>
                                </div>
                                {ROUTES_WITH_HOSTNAMES.includes(route.kind) && (
                                    <div className="modal-field">
                                        <label className="modal-field__label">
                                            Hostnames
                                            <span className="modal-field__hint">
                                                Comma-separated. Sets spec.hostnames (SNI matching for TLSRoute).
                                            </span>
                                        </label>
                                        <input
                                            className="modal-field__input"
                                            value={route.hostnames}
                                            onChange={(e) => patchRoute(route.id, { hostnames: e.target.value })}
                                            placeholder="api.example.com, www.example.com"
                                        />
                                    </div>
                                )}
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Backends (Services)
                                        <span className="modal-field__hint">
                                            A Route only routes to Services; link an existing one or create a new Service inline.
                                        </span>
                                    </label>
                                    {route.backends.length === 0 && (
                                        <div className="modal-field__hint" style={{ marginBottom: '6px' }}>
                                            No backends yet; the route will be created without backendRefs.
                                        </div>
                                    )}
                                    {route.backends.map((backend, backendIndex) => (
                                        <div className="gateway-backend-row" key={backend.id}>
                                            <select
                                                className="modal-field__input modal-field__input--select"
                                                value={backend.mode}
                                                onChange={(e) =>
                                                    patchBackend(route.id, backend.id, {
                                                        mode: e.target.value as 'existing' | 'new',
                                                    })
                                                }
                                            >
                                                <option value="existing">Link to existing Service</option>
                                                <option value="new">Create new Service</option>
                                            </select>
                                            {backend.mode === 'existing' ? (
                                                <select
                                                    className={`modal-field__input modal-field__input--select ${error?.backendErrors?.[backendIndex] ? 'modal-field__input--invalid' : ''}`}
                                                    value={backend.service}
                                                    onChange={(e) =>
                                                        patchBackend(route.id, backend.id, { service: e.target.value })
                                                    }
                                                >
                                                    <option value="">(pick a Service)</option>
                                                    {serviceOptions.map((svc) => (
                                                        <option key={svc} value={svc}>{svc}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <>
                                                    <input
                                                        className="modal-field__input"
                                                        placeholder="Service name"
                                                        value={backend.newServiceName}
                                                        onChange={(e) =>
                                                            patchBackend(route.id, backend.id, {
                                                                newServiceName: e.target.value,
                                                            })
                                                        }
                                                    />
                                                    <input
                                                        className="modal-field__input"
                                                        type="number"
                                                        min={1}
                                                        max={65535}
                                                        placeholder="port"
                                                        value={backend.newServicePort}
                                                        onChange={(e) =>
                                                            patchBackend(route.id, backend.id, {
                                                                newServicePort: e.target.value,
                                                            })
                                                        }
                                                    />
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                className="modal-btn modal-btn--secondary"
                                                onClick={() => removeBackend(route.id, backend.id)}
                                            >
                                                Remove
                                            </button>
                                            {error?.backendErrors?.[backendIndex] && (
                                                <span className="modal-field__error">
                                                    {error.backendErrors[backendIndex]}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        className="modal-btn modal-btn--secondary"
                                        onClick={() => addBackend(route.id)}
                                    >
                                        + Add backend Service
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    <button type="button" className="modal-btn modal-btn--secondary" onClick={addRoute}>
                        + Add another Route
                    </button>
                </div>

                <div className="modal-footer">
                    <button type="button" className="modal-btn modal-btn--secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        disabled={Boolean(gcNameError || gwNameError || namespaceError || hasErrors)}
                        onClick={handleCreate}
                    >
                        Create Gateway API
                    </button>
                </div>
            </div>

            {/* Stacked namespace creation prompt: renders above the gateway
                modal and auto-selects the new namespace on success. */}
            {nsCreateOpen && (
                <NamespaceModal
                    onClose={() => setNsCreateOpen(false)}
                    onCreated={(created) => setGwNamespace(created)}
                />
            )}
        </div>
    );
}
