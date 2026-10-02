import { describe, it, expect } from 'vitest';
import {
    buildGraph,
    getVpaTarget,
    getResourcesTargetedByVpa,
    nodeIdFor,
} from '../../utils/buildGraph';
import { connectResources, explainInvalidLink } from '../../utils/linkResources';
import type { K8sResource } from '../../types/types';

function dep(name: string, replicas = 1): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name },
        spec: {
            replicas,
            selector: { matchLabels: { app: name } },
            template: { metadata: { labels: { app: name } }, spec: {} },
        },
    };
}

function pod(name: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name },
        spec: { containers: [{ name: 'c', image: 'img' }] },
    };
}

function vpa(name: string, targetKind?: string, targetName?: string): K8sResource {
    return {
        apiVersion: 'autoscaling.k8s.io/v1',
        kind: 'VerticalPodAutoscaler',
        metadata: { name },
        spec: {
            ...(targetKind && targetName
                ? { targetRef: { apiVersion: 'apps/v1', kind: targetKind, name: targetName } }
                : {}),
            updatePolicy: { updateMode: 'Auto' },
        },
    };
}

describe('VPA targetRef parsing', () => {
    it('getVpaTarget reads spec.targetRef for every pod-bearing kind', () => {
        expect(getVpaTarget(vpa('v', 'Deployment', 'web'))).toEqual({ kind: 'Deployment', name: 'web' });
        expect(getVpaTarget(vpa('v', 'ReplicaSet', 'web-abc12'))).toEqual({ kind: 'ReplicaSet', name: 'web-abc12' });
        expect(getVpaTarget(vpa('v', 'Pod', 'p-1'))).toEqual({ kind: 'Pod', name: 'p-1' });
        expect(getVpaTarget(vpa('v', 'Job', 'j-1'))).toEqual({ kind: 'Job', name: 'j-1' });
        expect(getVpaTarget(vpa('v', 'CronJob', 'c-1'))).toEqual({ kind: 'CronJob', name: 'c-1' });
    });

    it('getVpaTarget rejects non-pod-bearing kinds and missing targets', () => {
        expect(getVpaTarget(vpa('v', 'Service', 's-1'))).toBeUndefined();
        expect(getVpaTarget(vpa('v'))).toBeUndefined();
    });
});

describe('VPA graph edges', () => {
    it("draws a 'right-sizes' edge to the Deployment, never to its nested Pods", () => {
        const { nodes, edges } = buildGraph(
            [dep('web', 2), vpa('web-vpa', 'Deployment', 'web')],
            []
        );
        const vpaNode = nodes.find((n) => n.data.kind === 'VerticalPodAutoscaler')!;
        const depNode = nodes.find((n) => n.data.kind === 'Deployment')!;
        const podNodes = nodes.filter((n) => n.data.kind === 'Pod');
        expect(vpaNode).toBeDefined();
        expect(
            edges.some(
                (e) =>
                    e.source === vpaNode.id &&
                    e.target === depNode.id &&
                    e.label === 'right-sizes'
            )
        ).toBe(true);
        podNodes.forEach((p) => {
            expect(edges.some((e) => e.source === vpaNode.id && e.target === p.id)).toBe(false);
        });
    });

    it('draws an edge to standalone Pod, Job and CronJob targets', () => {
        const job: K8sResource = {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: { name: 'j-1' },
            spec: {
                parallelism: 1,
                template: {
                    spec: { restartPolicy: 'Never', containers: [{ name: 'c', image: 'i' }] },
                },
            },
        };
        const cron: K8sResource = {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            metadata: { name: 'c-1' },
            spec: {
                schedule: '* * * * *',
                jobTemplate: {
                    spec: {
                        template: {
                            spec: { restartPolicy: 'Never', containers: [{ name: 'c', image: 'i' }] },
                        },
                    },
                },
            },
        };
        const { nodes, edges } = buildGraph(
            [
                pod('p-1'),
                job,
                cron,
                vpa('v-pod', 'Pod', 'p-1'),
                vpa('v-job', 'Job', 'j-1'),
                vpa('v-cron', 'CronJob', 'c-1'),
            ],
            []
        );
        const labelsOf = (vpaName: string): string[] =>
            edges
                .filter((e) => {
                    const src = nodes.find((n) => n.id === e.source);
                    return src?.data.name === vpaName;
                })
                .map((e) => e.label as string);
        expect(labelsOf('v-pod')).toContain('right-sizes');
        expect(labelsOf('v-job')).toContain('right-sizes');
        expect(labelsOf('v-cron')).toContain('right-sizes');
    });

    it('shares the autoscaler lane with a HorizontalPodAutoscaler without overlapping', () => {
        const h: K8sResource = {
            apiVersion: 'autoscaling/v2',
            kind: 'HorizontalPodAutoscaler',
            metadata: { name: 'a-hpa' },
            spec: {
                scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'a' },
                minReplicas: 1,
                maxReplicas: 5,
            },
        };
        const { nodes } = buildGraph([dep('a', 1), h, vpa('a-vpa', 'Deployment', 'a')], []);
        const hpaNode = nodes.find((n) => n.data.kind === 'HorizontalPodAutoscaler')!;
        const vpaNode = nodes.find((n) => n.data.kind === 'VerticalPodAutoscaler')!;
        expect(hpaNode.position.y).toBe(vpaNode.position.y);
        const hpaW = typeof hpaNode.style?.width === 'number' ? hpaNode.style.width : 175;
        const vpaW = typeof vpaNode.style?.width === 'number' ? vpaNode.style.width : 185;
        const overlap =
            vpaNode.position.x < hpaNode.position.x + hpaW &&
            vpaNode.position.x + vpaW > hpaNode.position.x;
        expect(overlap).toBe(false);
    });
});

describe('VPA manual linking', () => {
    it('writes targetRef when connecting a VPA to a workload', () => {
        const resources = [dep('web', 1), vpa('web-vpa')];
        const linked = connectResources(resources, 1, 0);
        expect(linked).not.toBeNull();
        expect(linked!.resources[1].spec).toMatchObject({
            targetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'web' },
            updatePolicy: { updateMode: 'Auto' },
        });
    });

    it('replaces an existing targetRef (a VPA has exactly one target)', () => {
        const resources = [dep('web', 1), dep('api', 1), vpa('web-vpa', 'Deployment', 'web')];
        const linked = connectResources(resources, 1, 2);
        expect(linked!.resources[2].spec).toMatchObject({
            targetRef: { kind: 'Deployment', name: 'api' },
        });
    });

    it('rejects VPA ↔ Service with null and explains why', () => {
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 's' },
            spec: { selector: { app: 'x' }, ports: [{ port: 80 }] },
        };
        const resources = [svc, vpa('v')];
        expect(connectResources(resources, 1, 0)).toBeNull();
        expect(explainInvalidLink('VerticalPodAutoscaler', 'Service')).toContain('not Services');
    });
});

describe('VPA helpers', () => {
    it('getResourcesTargetedByVpa lists every VPA pointing at a resource', () => {
        const resources = [
            dep('web', 1),
            vpa('a', 'Deployment', 'web'),
            vpa('b', 'Deployment', 'other'),
            vpa('c', 'Deployment', 'web'),
        ];
        const names = getResourcesTargetedByVpa(resources, 'Deployment', 'web').map(
            (r) => r.metadata.name
        );
        expect(names.sort()).toEqual(['a', 'c']);
    });

    it('nodeIdFor produces stable VerticalPodAutoscaler ids', () => {
        expect(nodeIdFor('VerticalPodAutoscaler', 'web-vpa')).toBe(
            'VerticalPodAutoscaler-web-vpa'
        );
    });
});
