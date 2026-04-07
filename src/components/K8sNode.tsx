import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { K8sNodeData } from '../utils/buildGraph';

const KIND_CONFIG: Record<string, { color: string; code: string }> = {
    Deployment: {
        color: '#5aa9ff',
        code: 'DP',
    },
    Service: {
        color: '#d48bff',
        code: 'SV',
    },
    Ingress: {
        color: '#53e0d9',
        code: 'IG',
    },
    ReplicaSet: {
        color: '#ffb86c',
        code: 'RS',
    },
    Pod: {
        color: '#7ee787',
        code: 'PD',
    },
};

/**
 * Custom React Flow node component for rendering a K8s resource.
 * Shows a geometric architecture block with kind and name.
 */
function K8sNodeComponent({ data }: NodeProps) {
    const nodeData = data as unknown as K8sNodeData;
    const config = KIND_CONFIG[nodeData.kind] ?? {
        color: '#8b949e',
        code: 'RS',
    };

    return (
        <div className="k8s-node" style={{ ['--kind-color' as string]: config.color }}>
            <Handle
                type="target"
                position={Position.Top}
                className="k8s-handle"
            />
            <div className="k8s-node__badge">
                <span className="k8s-node__square">{config.code}</span>
                <span className="k8s-node__kind">{nodeData.kind}</span>
            </div>
            <div className="k8s-node__name">{nodeData.name}</div>
            {nodeData.namespace && (
                <div className="k8s-node__namespace">
                    ns: {nodeData.namespace}
                </div>
            )}
            <div className="k8s-node__details">
                {buildResourceDetails(nodeData).map((item) => (
                    <span key={item} className="k8s-node__detail-chip">
                        {item}
                    </span>
                ))}
            </div>

            <Handle
                type="source"
                position={Position.Bottom}
                className="k8s-handle"
            />
        </div>
    );
}

function buildResourceDetails(nodeData: K8sNodeData): string[] {
    const details: string[] = [];
    const spec = (nodeData.resource?.spec ?? {}) as Record<string, any>;
    if (nodeData.kind === 'Deployment' || nodeData.kind === 'ReplicaSet') {
        if (typeof spec.replicas === 'number') details.push(`replicas:${spec.replicas}`);
        const selector = spec.selector?.matchLabels as Record<string, string> | undefined;
        if (selector && selector.app) details.push(`selector:${selector.app}`);
    }
    if (nodeData.kind === 'Pod') {
        const container = spec.containers?.[0];
        if (container?.image) details.push(`image:${container.image}`);
    }
    if (nodeData.kind === 'Service') {
        if (spec.type) details.push(`type:${spec.type}`);
        const port = spec.ports?.[0]?.port;
        if (port) details.push(`port:${port}`);
    }
    if (nodeData.kind === 'Ingress') {
        const host = spec.rules?.[0]?.host;
        const path = spec.rules?.[0]?.http?.paths?.[0]?.path;
        if (host) details.push(`host:${host}`);
        if (path) details.push(`path:${path}`);
    }
    return details.slice(0, 3);
}

export default memo(K8sNodeComponent);
