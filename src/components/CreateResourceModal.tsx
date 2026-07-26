import { useEffect, useMemo, useRef, useState } from 'react';
import type { K8sResource, SupportedKind } from '../types/types';
import { getWorkloadPodLabels } from '../utils/buildGraph';
import { useVeltraStore } from '../store/store';

interface Props {
    kind: SupportedKind;
    onClose: () => void;
}

const KIND_COLORS: Record<string, string> = {
    Deployment: '#10b981',
    ReplicaSet: '#f97316',
    Pod: '#14b8a6',
    Service: '#3b82f6',
    Ingress: '#8b5cf6',
};

const KIND_ICONS: Record<string, React.ReactNode> = {
    Deployment: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
            <rect x="14" y="2" width="8" height="8" rx="1.5" />
            <rect x="2" y="14" width="8" height="8" rx="1.5" />
            <path d="M6 10v4M10 6h4M14 18h4" strokeDasharray="2 2" />
        </svg>
    ),
    ReplicaSet: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="10" height="10" rx="2" />
            <rect x="11" y="11" width="10" height="10" rx="2" strokeDasharray="2 2" />
            <path d="M13 8h3v3" strokeDasharray="2 2" />
        </svg>
    ),
    Pod: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
        </svg>
    ),
    Service: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 4h-4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2z" />
            <path d="M8 13H4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2v-3a2 2 0 00-2-2z" />
            <path d="M9 8v5M15 15v-5M12 5v14" strokeDasharray="2 2" />
        </svg>
    ),
    Ingress: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
    ),
};

function hexToRgba(hex: string, alpha: number): string {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!r) return `rgba(59,130,246,${alpha})`;
    return `rgba(${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)},${alpha})`;
}

export default function CreateResourceModal({ kind, onClose }: Props) {
    const nodes = useVeltraStore((s) => s.nodes);
    const addConfiguredNode = useVeltraStore((s) => s.addConfiguredNode);

    const suggestedName = useMemo(() => {
        const base = kind.toLowerCase();
        let idx = 1;
        while (nodes.some((n) => n.data.kind === kind && n.data.name === `${base}-${idx}`)) idx++;
        return `${base}-${idx}`;
    }, [kind, nodes]);

    const [name, setName] = useState(suggestedName);

    // Duplicate kind+name pairs would collide in the graph and are invalid in K8s
    const nameError = useMemo(() => {
        const trimmed = name.trim();
        if (!trimmed) return ''; // falls back to the suggested name
        return nodes.some((n) => n.data.kind === kind && n.data.name === trimmed)
            ? `A ${kind} named “${trimmed}” already exists.`
            : '';
    }, [name, kind, nodes]);

    const [namespace, setNamespace] = useState('default');
    // Workloads/Pods auto-derive their app label from the name until the user edits it
    const [appLabelDraft, setAppLabelDraft] = useState('');
    const [appLabelTouched, setAppLabelTouched] = useState(false);
    const [replicas, setReplicas] = useState('3');
    const [containerName, setContainerName] = useState('app');
    const [containerImage, setContainerImage] = useState('nginx:latest');
    const [serviceType, setServiceType] = useState('ClusterIP');
    const [port, setPort] = useState('80');
    const [targetPort, setTargetPort] = useState('8080');
    const [host, setHost] = useState('');
    const [path, setPath] = useState('/');
    const [backendService, setBackendService] = useState('');

    const firstInputRef = useRef<HTMLInputElement>(null);

    const color = KIND_COLORS[kind] ?? '#3b82f6';
    const icon = KIND_ICONS[kind];

    const isWorkload = kind === 'Deployment' || kind === 'ReplicaSet';

    // Auto-generated label follows the resource name until the user overrides it
    const appLabel = appLabelTouched
        ? appLabelDraft
        : isWorkload || kind === 'Pod'
        ? name.trim() || suggestedName
        : appLabelDraft;

    const serviceOptions = useMemo(
        () => nodes.filter((n) => n.data.kind === 'Service').map((n) => n.data.name as string),
        [nodes]
    );

    // Existing selectable targets: app-label values with the real resources carrying them
    const workloadTargets = useMemo(() => {
        const owners = new Map<string, string[]>();
        nodes.forEach((n) => {
            if (n.data.synthetic) return;
            const k = n.data.kind;
            let value: string | undefined;
            if (k === 'Deployment' || k === 'ReplicaSet') value = getWorkloadPodLabels(n.data.resource)?.app;
            else if (k === 'Pod') value = n.data.resource.metadata?.labels?.app;
            if (!value) return;
            const list = owners.get(value) ?? [];
            list.push(`${k} ${n.data.name}`);
            owners.set(value, list);
        });
        return Array.from(owners.entries()).map(([value, list]) => ({ value, owners: list.join(', ') }));
    }, [nodes]);

    const namespaceOptions = useMemo(() => {
        const vals = new Set<string>(['default', 'kube-system']);
        nodes.forEach((n) => { if (n.data.namespace) vals.add(n.data.namespace); });
        return Array.from(vals).sort();
    }, [nodes]);

    useEffect(() => {
        firstInputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    function buildResource(): K8sResource {
        const meta: K8sResource['metadata'] = {
            name: name.trim() || suggestedName,
            namespace: namespace || 'default',
        };
        if (appLabel.trim()) meta.labels = { app: appLabel.trim() };

        switch (kind) {
            case 'Deployment':
            case 'ReplicaSet': {
                const replicaNum = parseInt(replicas, 10);
                const label = appLabel.trim() || meta.name;
                return {
                    apiVersion: 'apps/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec: {
                        replicas: Number.isFinite(replicaNum) ? replicaNum : 1,
                        selector: { matchLabels: { app: label } },
                        template: {
                            metadata: { labels: { app: label } },
                            spec: {
                                containers: [{ name: 'app', image: 'nginx:latest' }],
                            },
                        },
                    },
                };
            }
            case 'Pod':
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: meta,
                    spec: {
                        containers: [
                            {
                                name: containerName.trim() || 'app',
                                image: containerImage.trim() || 'nginx:latest',
                            },
                        ],
                    },
                };
            case 'Service': {
                const portNum = parseInt(port, 10);
                const tpNum = parseInt(targetPort, 10);
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        type: serviceType || 'ClusterIP',
                        ...(appLabel.trim() ? { selector: { app: appLabel.trim() } } : {}),
                        ports: [
                            {
                                port: Number.isFinite(portNum) ? portNum : 80,
                                targetPort: Number.isFinite(tpNum) ? tpNum : 8080,
                            },
                        ],
                    },
                };
            }
            case 'Ingress':
                return {
                    apiVersion: 'networking.k8s.io/v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        rules: [
                            {
                                ...(host.trim() ? { host: host.trim() } : {}),
                                http: {
                                    paths: [
                                        {
                                            path: path.trim() || '/',
                                            pathType: 'Prefix',
                                            ...(backendService
                                                ? {
                                                      backend: {
                                                          service: {
                                                              name: backendService,
                                                              port: { number: 80 },
                                                          },
                                                      },
                                                  }
                                                : {}),
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                };
        }
    }

    function handleCreate() {
        if (nameError) return;
        addConfiguredNode(kind, buildResource());
        onClose();
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header">
                    <div
                        className="modal-header__icon"
                        style={{
                            backgroundColor: hexToRgba(color, 0.13),
                            border: `1px solid ${hexToRgba(color, 0.28)}`,
                            color,
                        }}
                    >
                        {icon}
                    </div>
                    <span className="modal-header__title">Create {kind}</span>
                    <button type="button" className="modal-header__close" onClick={onClose} title="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* Base fields */}
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Name</label>
                            <input
                                ref={firstInputRef}
                                className={`modal-field__input ${nameError ? 'modal-field__input--invalid' : ''}`}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={suggestedName}
                            />
                            {nameError && <span className="modal-field__error">{nameError}</span>}
                        </div>
                        <div className="modal-field">
                            <label className="modal-field__label">Namespace</label>
                            <input
                                className="modal-field__input"
                                value={namespace}
                                list="modal-ns-list"
                                onChange={(e) => setNamespace(e.target.value)}
                                placeholder="default"
                            />
                            <datalist id="modal-ns-list">
                                {namespaceOptions.map((ns) => <option key={ns} value={ns} />)}
                            </datalist>
                        </div>
                    </div>

                    {/* App Label — auto-generated for workloads/Pods, target picker for Services */}
                    {(isWorkload || kind === 'Pod') && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                App Label
                                <span className="modal-field__hint">
                                    {isWorkload
                                        ? 'Auto-generated from the name. Sets metadata.labels.app and spec.selector.matchLabels.app.'
                                        : 'Auto-generated from the name. Sets metadata.labels.app — enables containment inside matching ReplicaSets.'}
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={appLabel}
                                onChange={(e) => {
                                    setAppLabelTouched(true);
                                    setAppLabelDraft(e.target.value);
                                }}
                                placeholder="my-app"
                            />
                        </div>
                    )}
                    {kind === 'Service' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Route to workload
                                <span className="modal-field__hint">
                                    Sets spec.selector.app — pick an existing workload or Pod to send traffic to.
                                </span>
                            </label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={appLabel}
                                onChange={(e) => {
                                    setAppLabelTouched(true);
                                    setAppLabelDraft(e.target.value);
                                }}
                            >
                                <option value="">(no selector yet)</option>
                                {workloadTargets.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.value} — {t.owners}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Workload: replicas */}
                    {isWorkload && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Replicas
                                <span className="modal-field__hint">
                                    {kind === 'Deployment'
                                        ? 'Its ReplicaSet and this many Pods are created automatically, like a real cluster.'
                                        : 'This many Pods are created automatically.'}
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={0}
                                value={replicas}
                                onChange={(e) => setReplicas(e.target.value)}
                                placeholder="3"
                            />
                        </div>
                    )}

                    {/* Pod: container */}
                    {kind === 'Pod' && (
                        <div className="modal-row">
                            <div className="modal-field">
                                <label className="modal-field__label">Container Name</label>
                                <input
                                    className="modal-field__input"
                                    value={containerName}
                                    onChange={(e) => setContainerName(e.target.value)}
                                    placeholder="app"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">Image</label>
                                <input
                                    className="modal-field__input"
                                    value={containerImage}
                                    onChange={(e) => setContainerImage(e.target.value)}
                                    placeholder="nginx:latest"
                                />
                            </div>
                        </div>
                    )}

                    {/* Service: type + ports */}
                    {kind === 'Service' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Service Type</label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={serviceType}
                                        onChange={(e) => setServiceType(e.target.value)}
                                    >
                                        <option>ClusterIP</option>
                                        <option>NodePort</option>
                                        <option>LoadBalancer</option>
                                        <option>ExternalName</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Port</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        value={port}
                                        onChange={(e) => setPort(e.target.value)}
                                        placeholder="80"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Target Port</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        value={targetPort}
                                        onChange={(e) => setTargetPort(e.target.value)}
                                        placeholder="8080"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Ingress: host + path + backend */}
                    {kind === 'Ingress' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Host</label>
                                    <input
                                        className="modal-field__input"
                                        value={host}
                                        onChange={(e) => setHost(e.target.value)}
                                        placeholder="my-app.example.com"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Path</label>
                                    <input
                                        className="modal-field__input"
                                        value={path}
                                        onChange={(e) => setPath(e.target.value)}
                                        placeholder="/"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Backend Service
                                    <span className="modal-field__hint">
                                        Lists the Services that currently exist on the canvas.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={backendService}
                                    onChange={(e) => setBackendService(e.target.value)}
                                >
                                    <option value="">(no backend yet)</option>
                                    {serviceOptions.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button type="button" className="modal-btn modal-btn--secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': color } as React.CSSProperties}
                        onClick={handleCreate}
                        disabled={!!nameError}
                        title={nameError || `Create ${kind}`}
                    >
                        Create {kind}
                    </button>
                </div>
            </div>
        </div>
    );
}
