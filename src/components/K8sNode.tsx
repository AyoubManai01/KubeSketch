import { cloneElement, memo, type ReactElement, type ReactNode } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { K8sNodeData } from '../utils/buildGraph';
import { isClusterScoped } from '../utils/k8sScope';
import { KIND_COLORS, KIND_ICONS } from './kindMeta';

// Node cards size their icons with the .k8s-icon class on the svg itself,
// so the shared (class-free) icons are cloned with it attached here.
const ICONS: Record<string, ReactNode> = Object.fromEntries(
    Object.entries(KIND_ICONS).map(([kind, icon]) => [
        kind,
        cloneElement(icon as ReactElement<{ className?: string }>, { className: 'k8s-icon' }),
    ])
);

function K8sNodeComponent({ data }: NodeProps) {
    const nodeData = data as unknown as K8sNodeData;
    const kind = nodeData.kind;
    const color = KIND_COLORS[kind] ?? '#8b949e';
    const icon = ICONS[kind] ?? ICONS.Pod;

    const isContainer =
        kind === 'Deployment' ||
        kind === 'ReplicaSet';
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
                {kind === 'HorizontalPodAutoscaler' && typeof spec.maxReplicas === 'number' && (
                    <div className="k8s-node__badge" title="Max replicas">
                        ≤ {spec.maxReplicas}
                    </div>
                )}
                {kind === 'Job' && typeof spec.parallelism === 'number' && (
                    <div className="k8s-node__badge" title="Pods running in parallel">
                        ∥{spec.parallelism} Pods
                    </div>
                )}
                {kind === 'CronJob' && typeof spec.schedule === 'string' && (
                    <div className="k8s-node__badge" title="Cron schedule">
                        {spec.schedule}
                    </div>
                )}
                {kind === 'VerticalPodAutoscaler' &&
                    typeof spec.updatePolicy?.updateMode === 'string' && (
                        <div className="k8s-node__badge" title="Update mode">
                            {spec.updatePolicy.updateMode}
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
                {kind === 'Gateway' && typeof spec.listeners?.[0]?.port === 'number' && (
                    <div className="k8s-node__badge" title="Listener port">
                        :{spec.listeners[0].port}
                    </div>
                )}
                {(kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TLSRoute') &&
                    Array.isArray(spec.hostnames) &&
                    typeof spec.hostnames[0] === 'string' && (
                        <div className="k8s-node__badge" title="First hostname">
                            {spec.hostnames[0]}
                        </div>
                    )}
            </div>

            {/* Content Body (only for Leaf Nodes or empty Containers) */}
            {!isContainer && (
                <div className="k8s-node__body">
                    {/* Cluster-scoped kinds (PV/StorageClass) have no namespace */}
                    {nodeData.namespace && !isClusterScoped(nodeData.kind) && (
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
    if (nodeData.kind === 'HorizontalPodAutoscaler') {
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
    if (nodeData.kind === 'VerticalPodAutoscaler') {
        const target = spec.targetRef;
        if (target?.kind && target.name) {
            details.push({ key: 'right-sizes', val: `${target.kind} ${target.name}` });
        }
        if (typeof spec.updatePolicy?.updateMode === 'string') {
            details.push({ key: 'update mode', val: spec.updatePolicy.updateMode });
        }
        const policy = spec.resourcePolicy?.containerPolicies?.[0];
        if (policy) {
            const minCpu = policy.minAllowed?.cpu;
            const maxCpu = policy.maxAllowed?.cpu;
            const minMem = policy.minAllowed?.memory;
            const maxMem = policy.maxAllowed?.memory;
            if (minCpu || maxCpu) {
                details.push({ key: 'cpu', val: `${minCpu ?? 'n/a'} to ${maxCpu ?? '∞'}` });
            }
            if (minMem || maxMem) {
                details.push({ key: 'memory', val: `${minMem ?? 'n/a'} to ${maxMem ?? '∞'}` });
            }
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
    if (nodeData.kind === 'Job') {
        if (spec.restartPolicy || spec.template?.spec?.restartPolicy) {
            details.push({
                key: 'restart',
                val: String(spec.restartPolicy ?? spec.template?.spec?.restartPolicy),
            });
        }
        if (typeof spec.parallelism === 'number') {
            details.push({ key: 'parallelism', val: String(spec.parallelism) });
        }
        if (typeof spec.completions === 'number') {
            details.push({ key: 'completions', val: String(spec.completions) });
        }
        const container = spec.template?.spec?.containers?.[0];
        if (container?.name) {
            details.push({ key: 'container', val: container.name });
        }
        if (container?.image) {
            const parts = container.image.split('/');
            details.push({ key: 'image', val: parts[parts.length - 1] });
        }
    }
    if (nodeData.kind === 'CronJob') {
        if (spec.schedule) {
            details.push({ key: 'schedule', val: String(spec.schedule) });
        }
        const jobSpec = spec.jobTemplate?.spec;
        if (typeof jobSpec?.parallelism === 'number') {
            details.push({ key: 'parallelism', val: String(jobSpec.parallelism) });
        }
        if (typeof jobSpec?.completions === 'number') {
            details.push({ key: 'completions', val: String(jobSpec.completions) });
        }
        const container = jobSpec?.template?.spec?.containers?.[0];
        if (container?.name) {
            details.push({ key: 'container', val: container.name });
        }
        if (container?.image) {
            const parts = container.image.split('/');
            details.push({ key: 'image', val: parts[parts.length - 1] });
        }
    }
    if (nodeData.kind === 'GatewayClass') {
        if (spec.controllerName) {
            details.push({ key: 'controller', val: String(spec.controllerName) });
        }
    }
    if (nodeData.kind === 'Gateway') {
        if (spec.gatewayClassName) {
            details.push({ key: 'class', val: String(spec.gatewayClassName) });
        }
        const listenPort = spec.listeners?.[0]?.port;
        if (typeof listenPort === 'number') {
            details.push({ key: 'listen', val: `:${listenPort}` });
        }
    }
    if (
        nodeData.kind === 'HTTPRoute' ||
        nodeData.kind === 'GRPCRoute' ||
        nodeData.kind === 'TCPRoute' ||
        nodeData.kind === 'TLSRoute'
    ) {
        const parent = spec.parentRefs?.[0]?.name;
        if (parent) {
            details.push({ key: 'parent', val: parent });
        }
        const host = spec.hostnames?.[0];
        if (typeof host === 'string') {
            details.push({ key: 'host', val: host });
        }
        const backends = Array.isArray(spec.backendRefs)
            ? spec.backendRefs.filter((b: any) => b?.name).map((b: any) => b.name)
            : [];
        if (backends.length > 0) {
            details.push({ key: 'backends', val: backends.join(', ') });
        }
    }
    return details;
}

export default memo(K8sNodeComponent);
