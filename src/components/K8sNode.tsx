import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { K8sNodeData } from '../utils/buildGraph';

// Custom K8s inline SVG icons
const ICONS: Record<string, React.ReactNode> = {
    Deployment: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
            <rect x="14" y="2" width="8" height="8" rx="1.5" />
            <rect x="2" y="14" width="8" height="8" rx="1.5" />
            <path d="M6 10v4M10 6h4M14 18h4" strokeDasharray="2 2" />
        </svg>
    ),
    ReplicaSet: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="10" height="10" rx="2" />
            <rect x="11" y="11" width="10" height="10" rx="2" strokeDasharray="2 2" />
            <path d="M13 8h3v3" strokeDasharray="2 2" />
        </svg>
    ),
    Pod: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
        </svg>
    ),
    Service: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 4h-4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2z" />
            <path d="M8 13H4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2v-3a2 2 0 00-2-2z" />
            <path d="M9 8v5M15 15v-5M12 5v14" strokeDasharray="2 2" />
        </svg>
    ),
    Ingress: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
    ),
    HPA: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20V10M12 6V4" />
            <path d="M12 16l3-3-3-3-3 3 3 3z" />
            <path d="M5 6a7 7 0 0014 0" />
        </svg>
    ),
    ConfigMap: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16v12H4z" />
            <path d="M8 10h8M8 14h5" />
        </svg>
    ),
    PersistentVolumeClaim: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        </svg>
    ),
    PersistentVolume: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
    ),
    StorageClass: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="6" rx="2" />
            <rect x="3" y="14" width="18" height="6" rx="2" />
            <path d="M7 10v4M17 10v4" strokeDasharray="2 2" />
        </svg>
    ),
    Secret: (
        <svg className="k8s-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
            <circle cx="12" cy="15.5" r="1.5" />
        </svg>
    ),
};

const KIND_COLORS: Record<string, string> = {
    Deployment: '#10b981', // Green
    ReplicaSet: '#f97316', // Orange
    Pod: '#14b8a6',        // Teal
    Service: '#3b82f6',    // Blue
    Ingress: '#8b5cf6',    // Purple
    HPA: '#f59e0b',        // Amber
    ConfigMap: '#06b6d4',  // Cyan
    PersistentVolumeClaim: '#ec4899', // Pink
    PersistentVolume: '#84cc16',      // Lime
    StorageClass: '#6366f1',          // Indigo
    Secret: '#dc2626',                // Red
};

function K8sNodeComponent({ data }: NodeProps) {
    const nodeData = data as unknown as K8sNodeData;
    const kind = nodeData.kind;
    const color = KIND_COLORS[kind] ?? '#8b949e';
    const icon = ICONS[kind] ?? ICONS.Pod;

    const isContainer = kind === 'Deployment' || kind === 'ReplicaSet';
    const spec = (nodeData.resource?.spec ?? {}) as Record<string, any>;
    const managedBy = nodeData.synthetic ? nodeData.managedBy : undefined;

    return (
        <div
            className={`k8s-node k8s-node--${kind.toLowerCase()} ${isContainer ? 'k8s-node--container' : 'k8s-node--leaf'} ${nodeData.synthetic ? 'k8s-node--managed' : ''}`}
            style={{ ['--kind-color' as string]: color }}
        >
            {/* Every node accepts manual connections; the store resolves their K8s meaning */}
            <Handle
                type="target"
                position={Position.Top}
                className="k8s-handle k8s-handle-target"
            />

            {/* Header Drag Handle */}
            <div className="k8s-node__header k8s-node__drag-handle">
                <div className="k8s-node__title-group">
                    <span className="k8s-node__icon-wrapper" style={{ backgroundColor: `${color}15`, color }}>
                        {icon}
                    </span>
                    <div className="k8s-node__meta">
                        <span className="k8s-node__kind-label">{kind}</span>
                        <div className="k8s-node__title" title={nodeData.name}>{nodeData.name}</div>
                    </div>
                </div>

                {/* Badges / Quick stats */}
                {managedBy && (
                    <div
                        className="k8s-node__badge k8s-node__badge--managed"
                        title={`Created automatically by ${managedBy.kind} ${managedBy.name} (like a real cluster)`}
                    >
                        auto
                    </div>
                )}
                {kind === 'Deployment' && typeof spec.replicas === 'number' && (
                    <div className="k8s-node__badge" title="Desired Replicas">
                        {spec.replicas} Replicas
                    </div>
                )}
                {kind === 'ReplicaSet' && typeof spec.replicas === 'number' && (
                    <div className="k8s-node__badge" title="Desired Pods">
                        ×{spec.replicas} Pods
                    </div>
                )}
                {kind === 'HPA' && typeof spec.maxReplicas === 'number' && (
                    <div className="k8s-node__badge" title="Max replicas">
                        ≤ {spec.maxReplicas}
                    </div>
                )}
                {kind === 'PersistentVolumeClaim' &&
                    typeof spec.resources?.requests?.storage === 'string' && (
                        <div className="k8s-node__badge" title="Requested storage">
                            {spec.resources.requests.storage}
                        </div>
                    )}
                {kind === 'PersistentVolume' && typeof spec.capacity?.storage === 'string' && (
                    <div className="k8s-node__badge" title="Capacity">
                        {spec.capacity.storage}
                    </div>
                )}
            </div>

            {/* Content Body (only for Leaf Nodes or empty Containers) */}
            {!isContainer && (
                <div className="k8s-node__body">
                    {nodeData.namespace && (
                        <div className="k8s-node__info-row">
                            <span className="k8s-node__info-key">Namespace:</span>
                            <span className="k8s-node__info-val">{nodeData.namespace}</span>
                        </div>
                    )}
                    {buildResourceDetails(nodeData).map((detail) => (
                        <div key={detail.key} className="k8s-node__info-row">
                            <span className="k8s-node__info-key">{detail.key}:</span>
                            <span className="k8s-node__info-val" title={detail.val}>{detail.val}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Optional background grid for container cards */}
            {isContainer && (
                <div className="k8s-node__container-grid-overlay" />
            )}

            <Handle
                type="source"
                position={Position.Bottom}
                className="k8s-handle k8s-handle-source"
            />
        </div>
    );
}

interface DetailPair {
    key: string;
    val: string;
}

function buildResourceDetails(nodeData: K8sNodeData): DetailPair[] {
    const details: DetailPair[] = [];
    const spec = (nodeData.resource?.spec ?? {}) as Record<string, any>;

    if (nodeData.kind === 'Pod') {
        const container = spec.containers?.[0];
        if (container?.name) {
            details.push({ key: 'container', val: container.name });
        }
        if (container?.image) {
            // Shorten image tag if it's too long (e.g. docker.io/library/nginx:latest -> nginx:latest)
            const parts = container.image.split('/');
            const shortImage = parts[parts.length - 1];
            details.push({ key: 'image', val: shortImage });
        }
    }
    if (nodeData.kind === 'Service') {
        if (spec.type) {
            details.push({ key: 'type', val: spec.type });
        }
        const port = spec.ports?.[0]?.port;
        const targetPort = spec.ports?.[0]?.targetPort;
        if (port) {
            details.push({ key: 'port', val: `${port}${targetPort ? ` -> ${targetPort}` : ''}` });
        }
    }
    if (nodeData.kind === 'Ingress') {
        const host = spec.rules?.[0]?.host;
        const path = spec.rules?.[0]?.http?.paths?.[0]?.path;
        if (host) {
            details.push({ key: 'host', val: host });
        }
        if (path) {
            details.push({ key: 'path', val: path });
        }
    }
    if (nodeData.kind === 'HPA') {
        const target = spec.scaleTargetRef;
        if (target?.kind && target.name) {
            details.push({ key: 'scales', val: `${target.kind} ${target.name}` });
        }
        if (typeof spec.minReplicas === 'number') {
            details.push({ key: 'min', val: String(spec.minReplicas) });
        }
        if (typeof spec.maxReplicas === 'number') {
            details.push({ key: 'max', val: String(spec.maxReplicas) });
        }
        const utilization = spec.metrics?.[0]?.resource?.target?.averageUtilization;
        if (typeof utilization === 'number') {
            details.push({ key: 'cpu target', val: `${utilization}%` });
        }
    }
    if (nodeData.kind === 'ConfigMap') {
        const data = (nodeData.resource?.data ?? {}) as Record<string, unknown>;
        const keys = Object.keys(data);
        details.push({ key: 'keys', val: String(keys.length) });
        if (keys.length > 0) {
            details.push({ key: 'first', val: keys[0] });
        }
    }
    if (nodeData.kind === 'Secret') {
        const data = (nodeData.resource?.data ?? {}) as Record<string, unknown>;
        const keys = Object.keys(data);
        details.push({ key: 'keys', val: String(keys.length) });
        if (keys.length > 0) {
            details.push({ key: 'first', val: keys[0] });
        }
        if (nodeData.resource?.type) {
            details.push({ key: 'type', val: String(nodeData.resource.type) });
        }
    }
    if (nodeData.kind === 'PersistentVolumeClaim') {
        const modes = Array.isArray(spec.accessModes) ? spec.accessModes.join(', ') : '';
        if (modes) {
            details.push({ key: 'access', val: modes });
        }
        if (spec.resources?.requests?.storage) {
            details.push({ key: 'size', val: String(spec.resources.requests.storage) });
        }
        if (spec.storageClassName) {
            details.push({ key: 'storageClass', val: String(spec.storageClassName) });
        }
        if (spec.volumeName) {
            details.push({ key: 'bound to', val: `PV ${spec.volumeName}` });
        } else if (!spec.storageClassName) {
            details.push({ key: 'state', val: 'unbound' });
        }
    }
    if (nodeData.kind === 'PersistentVolume') {
        if (spec.capacity?.storage) {
            details.push({ key: 'capacity', val: String(spec.capacity.storage) });
        }
        const modes = Array.isArray(spec.accessModes) ? spec.accessModes.join(', ') : '';
        if (modes) {
            details.push({ key: 'access', val: modes });
        }
        if (spec.persistentVolumeReclaimPolicy) {
            details.push({ key: 'reclaim', val: String(spec.persistentVolumeReclaimPolicy) });
        }
        if (spec.claimRef?.name) {
            details.push({ key: 'bound to', val: `PVC ${spec.claimRef.name}` });
        }
    }
    if (nodeData.kind === 'StorageClass') {
        if (spec.provisioner) {
            details.push({ key: 'provisioner', val: String(spec.provisioner) });
        }
        if (spec.reclaimPolicy) {
            details.push({ key: 'reclaim', val: String(spec.reclaimPolicy) });
        }
    }
    return details;
}

export default memo(K8sNodeComponent);
