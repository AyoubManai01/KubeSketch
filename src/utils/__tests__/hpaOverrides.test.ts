import { describe, it, expect } from 'vitest';
import { applyHpaReplicaOverrides, buildGraph, replicasOf, effectiveReplicas } from '../buildGraph';
import type { K8sResource } from '../../types/types';

function dep(name: string, replicas: number): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name },
        spec: { replicas, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: {} } },
    };
}

function hpa(name: string, targetKind: string, targetName: string, min?: number, max?: number): K8sResource {
    return {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name },
        spec: {
            scaleTargetRef: { apiVersion: 'apps/v1', kind: targetKind, name: targetName },
            minReplicas: min,
            maxReplicas: max,
        },
    };
}

function statefulSet(name: string, replicas: number): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name },
        spec: {
            replicas,
            selector: { matchLabels: { app: name } },
            template: { metadata: { labels: { app: name } }, spec: {} },
        },
    };
}

describe('HorizontalPodAutoscaler replica priority', () => {
    it('clamps Deployment replicas up to minReplicas and writes back', () => {
        const resources = [dep('web', 3), hpa('web-hpa', 'Deployment', 'web', 4, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(4);
        expect(overrides).toHaveLength(1);
        expect(overrides[0]).toMatchObject({ kind: 'Deployment', name: 'web', original: 3, effective: 4, hpaName: 'web-hpa', reason: 'minReplicas', bound: 4 });
    });

    it('clamps Deployment replicas down to maxReplicas', () => {
        const resources = [dep('web', 20), hpa('web-hpa', 'Deployment', 'web', 1, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(10);
        expect(overrides[0].reason).toBe('maxReplicas');
    });

    it('does not clamp when spec.replicas is already inside the window', () => {
        const resources = [dep('web', 5), hpa('web-hpa', 'Deployment', 'web', 4, 10)];
        expect(applyHpaReplicaOverrides(resources)).toHaveLength(0);
        expect(replicasOf(resources[0])).toBe(5);
    });

    it('defaults minReplicas to 1 and treats missing max as unlimited', () => {
        const resources = [dep('web', 3), hpa('web-hpa', 'Deployment', 'web')];
        expect(applyHpaReplicaOverrides(resources)).toHaveLength(0);
        const resources2 = [dep('web', 0), hpa('web-hpa', 'Deployment', 'web', 4, 8)];
        applyHpaReplicaOverrides(resources2);
        expect(replicasOf(resources2[0])).toBe(4);
    });

    it('propagates a Deployment clamp to its owned ReplicaSet', () => {
        const rs: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'ReplicaSet',
            metadata: { name: 'web-abc12' },
            spec: { replicas: 3, selector: { matchLabels: { app: 'web' } }, template: { metadata: { labels: { app: 'web' } }, spec: {} } },
        };
        const resources = [dep('web', 3), rs, hpa('web-hpa', 'Deployment', 'web', 4, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(4);
        expect(replicasOf(rs)).toBe(4);
        expect(overrides).toHaveLength(2);
        expect(overrides[1]).toMatchObject({ kind: 'ReplicaSet', name: 'web-abc12', viaDeployment: 'web' });
    });

    it('clamps a ReplicaSet targeted directly by its own HorizontalPodAutoscaler', () => {
        const rs: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'ReplicaSet',
            metadata: { name: 'rs-1' },
            spec: { replicas: 2, selector: { matchLabels: { app: 'rs-1' } }, template: { metadata: { labels: { app: 'rs-1' } }, spec: {} } },
        };
        const resources = [rs, hpa('rs-hpa', 'ReplicaSet', 'rs-1', 4, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(rs)).toBe(4);
        expect(overrides).toHaveLength(1);
        expect(overrides[0].viaDeployment).toBeUndefined();
    });

    it('first matching HorizontalPodAutoscaler wins per workload', () => {
        const resources = [
            dep('web', 3),
            hpa('hpa-a', 'Deployment', 'web', 4, 10),
            hpa('hpa-b', 'Deployment', 'web', 7, 9),
        ];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(4);
        expect(overrides[0].hpaName).toBe('hpa-a');
    });

    it('clamps a StatefulSet targeted by its own HorizontalPodAutoscaler (no ReplicaSet propagation)', () => {
        const resources = [statefulSet('web', 2), hpa('web-hpa', 'StatefulSet', 'web', 4, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(4);
        expect(overrides).toHaveLength(1);
        expect(overrides[0]).toMatchObject({ kind: 'StatefulSet', name: 'web', hpaName: 'web-hpa', reason: 'minReplicas', bound: 4 });
        expect(overrides[0].viaDeployment).toBeUndefined();
    });

    it('clamps a StatefulSet down to maxReplicas', () => {
        const resources = [statefulSet('web', 20), hpa('web-hpa', 'StatefulSet', 'web', 1, 10)];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(10);
        expect(overrides[0].reason).toBe('maxReplicas');
    });

    it('materializes pods at the HorizontalPodAutoscaler-forced count on the canvas', () => {
        const resources = [dep('web', 3), hpa('web-hpa', 'Deployment', 'web', 4, 10)];
        applyHpaReplicaOverrides(resources);
        const { nodes } = buildGraph(resources, []);
        const rsNode = nodes.find((n) => n.data.kind === 'ReplicaSet');
        expect(rsNode?.data.resource.spec).toMatchObject({ replicas: 4 });
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(4);
    });

    it('effectiveReplicas clamps into [min, max]', () => {
        const h = hpa('h', 'Deployment', 'web', 4, 10);
        expect(effectiveReplicas(h, dep('web', 3))).toBe(4);
        expect(effectiveReplicas(h, dep('web', 8))).toBe(8);
        expect(effectiveReplicas(h, dep('web', 12))).toBe(10);
        expect(effectiveReplicas(h, dep('other', 3))).toBeUndefined();
    });
});
