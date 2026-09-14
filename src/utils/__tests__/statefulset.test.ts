import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildGraph,
    nodeIdFor,
    MAX_SYNTHETIC_PODS,
    replicasOf,
    getVpaTarget,
    getHpaTarget,
    getResourcesUsingConfigMap,
    getResourcesUsingSecret,
    getResourcesUsingPvc,
    getResourcesTargetedByVpa,
    applyHpaReplicaOverrides,
} from '../buildGraph';
import { connectResources, explainInvalidLink, linkConfigMapToWorkload, linkSecretToWorkload, linkPvcToWorkload } from '../linkResources';
import type { K8sResource } from '../../types/types';

function statefulSet(
    name: string,
    replicas?: number,
    volumeClaimTemplates?: Array<{ name: string; size?: string; accessMode?: string }>
): K8sResource {
    const spec: Record<string, unknown> = {
        ...(replicas !== undefined ? { replicas } : {}),
        selector: { matchLabels: { app: name } },
        template: {
            metadata: { labels: { app: name } },
            spec: {
                containers: [{ name: 'app', image: 'nginx:latest' }],
            },
        },
    };
    if (volumeClaimTemplates) {
        spec.volumeClaimTemplates = volumeClaimTemplates.map((t) => ({
            metadata: { name: t.name },
            spec: {
                accessModes: [t.accessMode ?? 'ReadWriteOnce'],
                resources: { requests: { storage: t.size ?? '1Gi' } },
            },
        }));
    }
    return {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name, namespace: 'default', labels: { app: name } },
        spec,
    };
}

function pvc(name: string, namespace = 'default'): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name, namespace },
        spec: {
            accessModes: ['ReadWriteOnce'],
            resources: { requests: { storage: '1Gi' } },
        },
    };
}

function pod(name: string, labels: Record<string, string>): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name, namespace: 'default', labels },
        spec: { containers: [{ name: 'c', image: 'img' }] },
    };
}

describe('StatefulSet materialization', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('nests ordinal Pods (<name>-0..N-1) directly inside the StatefulSet card — never a ReplicaSet', () => {
        const { nodes, edges } = buildGraph([statefulSet('web', 3)], []);
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet');
        expect(ssNode).toBeDefined();
        expect(ssNode!.parentId).toBeUndefined();
        expect(ssNode!.draggable).toBe(true);
        // No ReplicaSet is ever synthesized for a StatefulSet.
        expect(nodes.some((n) => n.data.kind === 'ReplicaSet')).toBe(false);

        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods.map((p) => p.data.name).sort()).toEqual(['web-0', 'web-1', 'web-2']);
        pods.forEach((p) => {
            expect(p.parentId).toBe(ssNode!.id);
            expect(p.extent).toBe('parent');
            expect(p.data.synthetic).toBe(true);
            expect(p.data.managedBy).toEqual({ kind: 'StatefulSet', name: 'web' });
            expect(p.draggable).toBe(false);
        });
        // No owns edges — StatefulSet pods are nested, not linked.
        expect(edges.some((e) => (e.label as string) === 'owns')).toBe(false);
    });

    it('caps materialization at MAX_SYNTHETIC_PODS but keeps the true replicas in spec', () => {
        const { nodes } = buildGraph([statefulSet('web', 50)], []);
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(MAX_SYNTHETIC_PODS);
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet')!;
        expect(replicasOf(ssNode.data.resource)).toBe(50);
    });

    it('claims explicit Pods matching its selector, then materializes the shortfall', () => {
        const { nodes } = buildGraph(
            [statefulSet('web', 3), pod('web-0', { app: 'web' }), pod('web-1', { app: 'web' })],
            []
        );
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(3);
        const explicit = pods.find((n) => n.data.name === 'web-0')!;
        expect(explicit.data.synthetic).toBeUndefined();
        expect(explicit.parentId).toBe(nodes.find((n) => n.data.kind === 'StatefulSet')!.id);
        const materialized = pods.find((n) => n.data.name === 'web-2')!;
        expect(materialized.data.synthetic).toBe(true);
    });

    it('never double-claims a Pod already owned by a ReplicaSet', () => {
        const rs: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'ReplicaSet',
            metadata: { name: 'rs-1', namespace: 'default' },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: 'rs-app' } },
                template: { metadata: { labels: { app: 'rs-app' } }, spec: {} },
            },
        };
        const sharedPod = pod('rs-1-0', { app: 'rs-app' });
        const { nodes } = buildGraph([statefulSet('web', 2), rs, sharedPod], []);
        const rsNode = nodes.find((n) => n.data.kind === 'ReplicaSet')!;
        const claimedByRs = nodes.filter(
            (n) => n.data.kind === 'Pod' && n.parentId === rsNode.id
        );
        expect(claimedByRs.map((n) => n.data.name)).toContain('rs-1-0');
        // The StatefulSet must not emit rs-1-0 as its own child too.
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet')!;
        const claimedBySs = nodes.filter((n) => n.data.kind === 'Pod' && n.parentId === ssNode.id);
        expect(claimedBySs.map((n) => n.data.name)).not.toContain('rs-1-0');
    });

    it('honors a saved position across rebuilds', () => {
        const first = buildGraph([statefulSet('web', 1)], []);
        const ss = first.nodes.find((n) => n.data.kind === 'StatefulSet')!;
        expect(ss.position.y).toBe(320);
        // Pin it, then rebuild with the previous nodes — the pin must win.
        const pinned = { ...ss, position: { x: 1200, y: 320 } };
        const second = buildGraph([statefulSet('web', 1)], [pinned]);
        const ss2 = second.nodes.find((n) => n.data.kind === 'StatefulSet')!;
        expect(ss2.position.x).toBe(1200);
    });

    it('auto-placed workloads clear a pinned StatefulSet (invariant 11)', () => {
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ 'StatefulSet:sticky': { x: 60, y: 320 } })
        );
        const dep: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'new-dep' },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: 'new-dep' } },
                template: { metadata: { labels: { app: 'new-dep' } }, spec: {} },
            },
        };
        const { nodes } = buildGraph([statefulSet('sticky', 1), dep], []);
        const depNode = nodes.find((n) => n.data.kind === 'Deployment')!;
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet')!;
        const ssWidth = Number(ssNode.style?.width ?? 220);
        // The deployment must not stack over the pinned StatefulSet.
        expect(depNode.position.x).toBeGreaterThanOrEqual(ssNode.position.x + ssWidth + 20);
    });
});

describe('StatefulSet autoscaler targeting', () => {
    it('HPA scaleTargetRef targets a StatefulSet and clamps its replicas (write-back)', () => {
        const hpa: K8sResource = {
            apiVersion: 'autoscaling/v2',
            kind: 'HorizontalPodAutoscaler',
            metadata: { name: 'web-hpa', namespace: 'default' },
            spec: {
                scaleTargetRef: { apiVersion: 'apps/v1', kind: 'StatefulSet', name: 'web' },
                minReplicas: 5,
                maxReplicas: 10,
            },
        };
        expect(getHpaTarget(hpa)).toEqual({ kind: 'StatefulSet', name: 'web' });
        const resources = [statefulSet('web', 2), hpa];
        const overrides = applyHpaReplicaOverrides(resources);
        expect(replicasOf(resources[0])).toBe(5);
        expect(overrides).toHaveLength(1);
        expect(overrides[0]).toMatchObject({ kind: 'StatefulSet', name: 'web', reason: 'minReplicas' });

        const { nodes, edges } = buildGraph(resources, []);
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(5);
        const scales = edges.find(
            (e) => e.source === nodes.find((n) => n.data.kind === 'HorizontalPodAutoscaler')!.id && (e.label as string) === 'scales'
        );
        expect(scales).toBeDefined();
        expect(scales!.target).toBe(nodes.find((n) => n.data.kind === 'StatefulSet')!.id);
    });

    it('VPA targetRef accepts a StatefulSet and draws a right-sizes edge', () => {
        const vpa: K8sResource = {
            apiVersion: 'autoscaling.k8s.io/v1',
            kind: 'VerticalPodAutoscaler',
            metadata: { name: 'web-vpa', namespace: 'default' },
            spec: {
                targetRef: { apiVersion: 'apps/v1', kind: 'StatefulSet', name: 'web' },
                updatePolicy: { updateMode: 'Auto' },
            },
        };
        expect(getVpaTarget(vpa)).toEqual({ kind: 'StatefulSet', name: 'web' });
        const { nodes, edges } = buildGraph([statefulSet('web', 2), vpa], []);
        const edge = edges.find(
            (e) => e.source === nodes.find((n) => n.data.kind === 'VerticalPodAutoscaler')!.id && (e.label as string) === 'right-sizes'
        );
        expect(edge).toBeDefined();
        expect(edge!.target).toBe(nodes.find((n) => n.data.kind === 'StatefulSet')!.id);
        expect(getResourcesTargetedByVpa([vpa], 'StatefulSet', 'web')).toHaveLength(1);
    });
});

describe('StatefulSet semantic edges', () => {
    it('draws Service selector edges to the nested Pods (fallback to the card at 0 replicas)', () => {
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'web-svc', namespace: 'default' },
            spec: { selector: { app: 'web' }, ports: [{ port: 80 }] },
        };
        const { nodes, edges } = buildGraph([statefulSet('web', 2), svc], []);
        const svcNode = nodes.find((n) => n.data.kind === 'Service')!;
        const podEdges = edges.filter((e) => e.source === svcNode.id);
        expect(podEdges).toHaveLength(2);
        expect(podEdges.every((e) => (e.label as string).startsWith('port:'))).toBe(true);

        const { edges: fallbackEdges } = buildGraph([statefulSet('web', 0), svc], []);
        const fallback = fallbackEdges.find((e) => e.source === svcNode.id);
        expect(fallback?.target).toBe(
            buildGraph([statefulSet('web', 0), svc], []).nodes.find((n) => n.data.kind === 'StatefulSet')!.id
        );
    });

    it('draws ConfigMap/Secret "uses" and PVC "mounts" edges from spec.template.spec', () => {
        const cm: K8sResource = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'cfg', namespace: 'default' },
        };
        const secret: K8sResource = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: { name: 'sec', namespace: 'default' },
        };
        const claim = pvc('data');
        const withRefs = statefulSet('web', 1);
        const podSpec = (withRefs.spec as any).template.spec;
        podSpec.containers[0].envFrom = [
            { configMapRef: { name: 'cfg' } },
            { secretRef: { name: 'sec' } },
        ];
        podSpec.volumes = [{ name: 'data', persistentVolumeClaim: { claimName: 'data' } }];

        const { nodes, edges } = buildGraph([withRefs, cm, secret, claim], []);
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet')!;
        const labels = edges.filter((e) => e.source === ssNode.id).map((e) => e.label);
        expect(labels).toContain('uses');
        expect(labels).toContain('mounts');
        const cmEdge = edges.find((e) => e.source === ssNode.id && (e.label as string) === 'uses' && e.target === nodes.find((n) => n.data.kind === 'ConfigMap')!.id);
        expect(cmEdge).toBeDefined();
        const secretEdge = edges.find((e) => e.source === ssNode.id && (e.label as string) === 'uses' && e.target === nodes.find((n) => n.data.kind === 'Secret')!.id);
        expect(secretEdge).toBeDefined();
        const mountEdge = edges.find((e) => e.source === ssNode.id && (e.label as string) === 'mounts');
        expect(mountEdge?.target).toBe(nodes.find((n) => n.data.kind === 'PersistentVolumeClaim')!.id);

        expect(getResourcesUsingConfigMap([withRefs], 'cfg')).toHaveLength(1);
        expect(getResourcesUsingSecret([withRefs], 'sec')).toHaveLength(1);
        expect(getResourcesUsingPvc([withRefs], 'data')).toHaveLength(1);
    });

    it('draws a "claims" edge to same-named PVCs from volumeClaimTemplates (explicit-only)', () => {
        const { nodes, edges } = buildGraph(
            [statefulSet('web', 2, [{ name: 'data', size: '2Gi', accessMode: 'ReadWriteOnce' }]), pvc('data')],
            []
        );
        const ssNode = nodes.find((n) => n.data.kind === 'StatefulSet')!;
        const pvcNode = nodes.find((n) => n.data.kind === 'PersistentVolumeClaim')!;
        const claim = edges.find(
            (e) => e.source === ssNode.id && e.target === pvcNode.id && (e.label as string) === 'claims'
        );
        expect(claim).toBeDefined();
        // Non-interactive, like every inferred edge (invariant 7).
        expect(claim!.deletable).toBe(false);
        expect(claim!.selectable).toBe(false);
        expect(claim!.interactionWidth).toBe(0);
    });

    it('draws no "claims" edge when the PVC is missing or in another namespace', () => {
        const { edges: noPvc } = buildGraph(
            [statefulSet('web', 1, [{ name: 'data' }])],
            []
        );
        expect(noPvc.some((e) => (e.label as string) === 'claims')).toBe(false);

        const { edges: wrongNs } = buildGraph(
            [statefulSet('web', 1, [{ name: 'data' }]), pvc('data', 'other-ns')],
            []
        );
        expect(wrongNs.some((e) => (e.label as string) === 'claims')).toBe(false);
    });
});

describe('StatefulSet manual connections', () => {
    it('connects Service / HPA / VPA / Pod ownership semantics', () => {
        const ss = statefulSet('web', 1);
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'svc', namespace: 'default' },
            spec: { ports: [{ port: 80 }] },
        };
        const hpa: K8sResource = {
            apiVersion: 'autoscaling/v2',
            kind: 'HorizontalPodAutoscaler',
            metadata: { name: 'hpa', namespace: 'default' },
            spec: {},
        };
        const vpa: K8sResource = {
            apiVersion: 'autoscaling.k8s.io/v1',
            kind: 'VerticalPodAutoscaler',
            metadata: { name: 'vpa', namespace: 'default' },
            spec: {},
        };
        const p = pod('web-0', { app: 'web' });

        const serviceLink = connectResources([ss, svc], 0, 1)!;
        expect(serviceLink.resources[1].spec).toMatchObject({ selector: { app: 'web' } });

        const hpaLink = connectResources([ss, hpa], 0, 1)!;
        expect((hpaLink.resources[1].spec as Record<string, any>).scaleTargetRef).toMatchObject({
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            name: 'web',
        });

        const vpaLink = connectResources([ss, vpa], 0, 1)!;
        expect((vpaLink.resources[1].spec as Record<string, any>).targetRef).toMatchObject({
            apiVersion: 'apps/v1',
            kind: 'StatefulSet',
            name: 'web',
        });

        const ownership = connectResources([ss, p], 0, 1)!;
        expect(ownership.resources[1].metadata.labels).toMatchObject({ app: 'web' });
    });

    it('rejects StatefulSet pairs with no K8s meaning', () => {
        expect(explainInvalidLink('Ingress', 'StatefulSet')).toContain('Service first');
        expect(explainInvalidLink('PersistentVolume', 'StatefulSet')).toContain('PVC');
        expect(explainInvalidLink('StatefulSet', 'CronJob')).toBeTruthy();
        // CronJob↔Job-style ownership rejections still apply to DaemonSet pairs.
        expect(connectResources([statefulSet('a'), statefulSet('b')], 0, 1)).toBeNull();
    });

    it('writes ConfigMap/Secret/PVC references into the StatefulSet pod template', () => {
        const cm: K8sResource = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'cfg', namespace: 'default' },
        };
        const secret: K8sResource = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: { name: 'sec', namespace: 'default' },
        };
        const claim = pvc('data');
        const ss = statefulSet('web', 1);

        // CM/Secret/PVC→workload links are intercepted by the store (mechanism
        // prompts) and land in the link*ToWorkload writers — exercise those directly.
        const cmLink = linkConfigMapToWorkload([cm, ss], 0, 1, 'envFrom')!;
        const cmSpec = cmLink.resources[1].spec as any;
        expect(cmSpec.template.spec.containers[0].envFrom).toContainEqual({ configMapRef: { name: 'cfg' } });

        const secretLink = linkSecretToWorkload([secret, ss], 0, 1, 'envFrom')!;
        const secretSpec = secretLink.resources[1].spec as any;
        expect(secretSpec.template.spec.containers[0].envFrom).toContainEqual({ secretRef: { name: 'sec' } });

        const pvcLink = linkPvcToWorkload([claim, ss], 0, 1, 'data')!;
        const pvcSpec = pvcLink.resources[1].spec as any;
        expect(pvcSpec.template.spec.volumes).toContainEqual({
            name: 'data',
            persistentVolumeClaim: { claimName: 'data' },
        });
    });
});

describe('StatefulSet ids and defaults', () => {
    it('nodeIdFor produces stable ids', () => {
        expect(nodeIdFor('StatefulSet', 'web')).toBe('StatefulSet-web');
    });

    it('replicasOf defaults to 1', () => {
        expect(replicasOf(statefulSet('a'))).toBe(1);
        expect(replicasOf(statefulSet('b', 3))).toBe(3);
        expect(replicasOf(statefulSet('c', 0))).toBe(0);
    });
});