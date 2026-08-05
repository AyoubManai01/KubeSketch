import { describe, it, expect } from 'vitest';
import { buildGraph, getPvcRefs, getPvcRefDetails, isSingleNodeAccessMode, replicasOf } from '../buildGraph';
import {
    connectResources,
    explainInvalidLink,
    linkPvcToWorkload,
    linkPvcToPv,
    linkPvcToStorageClass,
} from '../linkResources';
import type { K8sResource } from '../../types/types';

function pod(name: string, claimName?: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name },
        spec: claimName
            ? {
                  containers: [{ name: 'app', image: 'nginx:latest' }],
                  volumes: [{ name: `vol-${claimName}`, persistentVolumeClaim: { claimName } }],
              }
            : { containers: [{ name: 'app', image: 'nginx:latest' }] },
    };
}

function deployment(name: string, replicas: number, claimName?: string): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name },
        spec: {
            replicas,
            selector: { matchLabels: { app: name } },
            template: {
                metadata: { labels: { app: name } },
                spec: claimName
                    ? {
                          containers: [{ name: 'app', image: 'nginx:latest' }],
                          volumes: [
                              { name: `vol-${claimName}`, persistentVolumeClaim: { claimName } },
                          ],
                      }
                    : { containers: [{ name: 'app', image: 'nginx:latest' }] },
            },
        },
    };
}

function pvc(name: string, spec: Record<string, unknown> = {}): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name },
        spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } }, ...spec },
    };
}

function pv(name: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name },
        spec: { capacity: { storage: '10Gi' }, accessModes: ['ReadWriteOnce'] },
    };
}

function storageClass(name: string): K8sResource {
    return {
        apiVersion: 'storage.k8s.io/v1',
        kind: 'StorageClass',
        metadata: { name },
        spec: { provisioner: 'kubernetes.io/no-provisioner' },
    };
}

describe('storage graph building', () => {
    it('places PVC/PV/StorageClass in their own lanes below workloads', () => {
        const { nodes } = buildGraph([pvc('data'), pv('data-pv'), storageClass('fast')], []);
        const pvcNode = nodes.find((n) => n.data.kind === 'PersistentVolumeClaim');
        const pvNode = nodes.find((n) => n.data.kind === 'PersistentVolume');
        const scNode = nodes.find((n) => n.data.kind === 'StorageClass');
        expect(pvcNode?.position.y).toBe(840);
        expect(pvNode?.position.y).toBe(1000);
        expect(scNode?.position.y).toBe(1160);
    });

    it('draws pod→PVC "mounts" and PVC→PV "binds" edges', () => {
        const { edges } = buildGraph(
            [pod('web', 'data'), pvc('data', { volumeName: 'data-pv' }), pv('data-pv')],
            []
        );
        const mounts = edges.find((e) => e.label === 'mounts');
        const binds = edges.find((e) => e.label === 'binds');
        expect(mounts).toBeDefined();
        expect(mounts!.source).toContain('Pod-web');
        expect(mounts!.target).toContain('PersistentVolumeClaim-data');
        expect(binds).toBeDefined();
        expect(binds!.source).toContain('PersistentVolumeClaim-data');
        expect(binds!.target).toContain('PersistentVolume-data-pv');
    });

    it('draws PVC→StorageClass "binds" when storageClassName is set', () => {
        const { edges } = buildGraph(
            [pvc('data', { storageClassName: 'fast' }), storageClass('fast')],
            []
        );
        const binds = edges.find((e) => e.label === 'binds');
        expect(binds).toBeDefined();
        expect(binds!.target).toContain('StorageClass-fast');
    });

    it('volumeName wins over storageClassName for edge drawing', () => {
        const { edges } = buildGraph(
            [
                pvc('data', { volumeName: 'data-pv', storageClassName: 'fast' }),
                pv('data-pv'),
                storageClass('fast'),
            ],
            []
        );
        const binds = edges.filter((e) => e.label === 'binds');
        expect(binds).toHaveLength(1);
        expect(binds[0].target).toContain('PersistentVolume-data-pv');
    });

    it('draws no edge when the PVC/PV/StorageClass target is missing from the manifest', () => {
        const { edges } = buildGraph(
            [pod('web', 'missing-claim'), pvc('orphan', { volumeName: 'ghost-pv' })],
            []
        );
        expect(edges.filter((e) => e.label === 'mounts')).toHaveLength(0);
        expect(edges.filter((e) => e.label === 'binds')).toHaveLength(0);
    });

    it('never synthesizes storage resources', () => {
        const { nodes } = buildGraph(
            [pod('web', 'data'), pvc('data', { volumeName: 'data-pv' }), pv('data-pv')],
            []
        );
        const storageNodes = nodes.filter(
            (n) =>
                n.data.kind === 'PersistentVolumeClaim' ||
                n.data.kind === 'PersistentVolume' ||
                n.data.kind === 'StorageClass'
        );
        expect(storageNodes).toHaveLength(2);
        expect(storageNodes.every((n) => !n.data.synthetic)).toBe(true);
    });
});

describe('storage reference helpers', () => {
    it('getPvcRefs reads claim names from pod volumes', () => {
        expect(getPvcRefs(pod('web', 'data'))).toEqual(['data']);
        expect(getPvcRefs(pod('web'))).toEqual([]);
    });

    it('getPvcRefDetails returns claim + volume names', () => {
        expect(getPvcRefDetails(pod('web', 'data'))).toEqual([{ name: 'data', volumeName: 'vol-data' }]);
    });
});

describe('storage link semantics', () => {
    it('linkPvcToWorkload mounts the claim into a Pod under a unique volume name', () => {
        const resources = [pod('web'), pvc('data')];
        const result = linkPvcToWorkload(resources, 1, 0, 'mydata');
        const podSpec = result.resources[0].spec as any;
        expect(podSpec.volumes).toEqual([
            { name: 'mydata', persistentVolumeClaim: { claimName: 'data' } },
        ]);
    });

    it('linkPvcToWorkload de-dupes an already mounted claim', () => {
        const resources = [pod('web', 'data'), pvc('data')];
        const result = linkPvcToWorkload(resources, 1, 0, 'vol-data');
        expect((result.resources[0].spec as any).volumes).toHaveLength(1);
    });

    it('linkPvcToWorkload mounts the claim into a Deployment pod template', () => {
        const resources = [deployment('web', 3), pvc('data')];
        const result = linkPvcToWorkload(resources, 1, 0, 'mydata');
        const podSpec = (result.resources[0].spec as any).template.spec as any;
        expect(podSpec.volumes).toEqual([
            { name: 'mydata', persistentVolumeClaim: { claimName: 'data' } },
        ]);
    });

    it('isSingleNodeAccessMode flags RWO/RWOP but not RWX/ROX', () => {
        expect(isSingleNodeAccessMode(pvc('a', { accessModes: ['ReadWriteOnce'] }))).toBe(true);
        expect(isSingleNodeAccessMode(pvc('b', { accessModes: ['ReadWriteOncePod'] }))).toBe(true);
        expect(isSingleNodeAccessMode(pvc('c', { accessModes: ['ReadWriteMany'] }))).toBe(false);
        expect(isSingleNodeAccessMode(pvc('d', { accessModes: ['ReadOnlyMany'] }))).toBe(false);
        expect(isSingleNodeAccessMode(pvc('e', { accessModes: undefined }))).toBe(false);
    });

    it('isSingleNodeAccessMode reads the first access mode only', () => {
        expect(isSingleNodeAccessMode(pvc('f', { accessModes: ['ReadWriteOnce', 'ReadOnlyMany'] }))).toBe(true);
        expect(isSingleNodeAccessMode(pvc('g', { accessModes: ['ReadOnlyMany', 'ReadWriteOnce'] }))).toBe(false);
    });

    it('replicasOf counts workload replicas', () => {
        expect(replicasOf(deployment('web', 3))).toBe(3);
        expect(replicasOf(pod('standalone'))).toBe(1);
    });

    it('linkPvcToPv sets volumeName and clears storageClassName', () => {
        const resources = [pvc('data', { storageClassName: 'fast' }), pv('data-pv')];
        const result = linkPvcToPv(resources, 0, 1);
        const spec = result.resources[0].spec as Record<string, unknown>;
        expect(spec.volumeName).toBe('data-pv');
        expect('storageClassName' in spec).toBe(false);
    });

    it('linkPvcToStorageClass sets storageClassName and clears volumeName', () => {
        const resources = [pvc('data', { volumeName: 'data-pv' }), storageClass('fast')];
        const result = linkPvcToStorageClass(resources, 0, 1);
        const spec = result.resources[0].spec as Record<string, unknown>;
        expect(spec.storageClassName).toBe('fast');
        expect('volumeName' in spec).toBe(false);
    });

    it('connectResources binds PVC↔PV and PVC↔StorageClass directly', () => {
        const toPv = connectResources([pvc('data'), pv('data-pv')], 0, 1);
        expect((toPv!.resources[0].spec as any).volumeName).toBe('data-pv');
        const toSc = connectResources([pvc('data'), storageClass('fast')], 0, 1);
        expect((toSc!.resources[0].spec as any).storageClassName).toBe('fast');
    });

    it('explainInvalidLink rejects storage pairs with guidance', () => {
        expect(explainInvalidLink('PersistentVolumeClaim', 'Deployment')).toContain('Pod');
        expect(explainInvalidLink('PersistentVolume', 'Pod')).toContain('PVC');
        expect(explainInvalidLink('StorageClass', 'Service')).toContain('spec.storageClassName');
        expect(explainInvalidLink('PersistentVolumeClaim', 'Pod')).toContain('spec.volumes');
    });
});
