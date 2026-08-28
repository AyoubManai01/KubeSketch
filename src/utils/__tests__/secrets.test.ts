import { describe, it, expect } from 'vitest';
import { buildGraph, getSecretRefs, getSecretRefDetails, getIngressTlsSecretNames } from '../buildGraph';
import {
    linkSecretToWorkload,
    linkIngressToSecret,
    explainInvalidLink,
} from '../linkResources';
import type { K8sResource } from '../../types/types';

function pod(name: string, secretName?: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name },
        spec: secretName
            ? {
                  containers: [{ name: 'app', image: 'nginx:latest' }],
                  volumes: [{ name: `vol-${secretName}`, secret: { secretName } }],
              }
            : { containers: [{ name: 'app', image: 'nginx:latest' }] },
    };
}

function secret(name: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name },
        data: { username: 'dmFsdWU=', password: 'c2VjcmV0' },
    };
}

function deployment(name: string, secretName?: string): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name },
        spec: {
            replicas: 1,
            selector: { matchLabels: { app: name } },
            template: {
                metadata: { labels: { app: name } },
                spec: secretName
                    ? {
                          containers: [
                              {
                                  name: 'app',
                                  image: 'nginx:latest',
                                  envFrom: [{ secretRef: { name: secretName } }],
                              },
                          ],
                      }
                    : { containers: [{ name: 'app', image: 'nginx:latest' }] },
            },
        },
    };
}

function ingress(name: string, secretName?: string): K8sResource {
    return {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name },
        spec: {
            ...(secretName ? { tls: [{ secretName, hosts: ['app.example.com'] }] } : {}),
            rules: [
                {
                    http: {
                        paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'svc' } } }],
                    },
                },
            ],
        },
    };
}

describe('secret graph building', () => {
    it('places Secrets in their own lane below StorageClasses', () => {
        const { nodes } = buildGraph(
            [secret('db-creds'), { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'fast' }, spec: { provisioner: 'x' } } as K8sResource],
            []
        );
        const secretNode = nodes.find((n) => n.data.kind === 'Secret');
        const scNode = nodes.find((n) => n.data.kind === 'StorageClass');
        expect(secretNode?.position.y).toBe(1320);
        expect(scNode!.position.y).toBeLessThan(secretNode!.position.y);
    });

    it('draws workload→Secret "uses" edges for volume mounts and envFrom', () => {
        const { edges } = buildGraph([pod('web', 'db-creds'), deployment('api', 'db-creds'), secret('db-creds')], []);
        const uses = edges.filter((e) => e.label === 'uses' && e.target.includes('Secret-db-creds'));
        expect(uses).toHaveLength(2);
        expect(uses[0].source).toContain('Pod-web');
        expect(uses[1].source).toContain('Deployment-api');
    });

    it('draws Ingress→Secret "tls" edges from spec.tls[].secretName', () => {
        const { edges } = buildGraph([ingress('public', 'tls-secret'), secret('tls-secret')], []);
        const tls = edges.find((e) => e.label === 'tls');
        expect(tls).toBeDefined();
        expect(tls!.source).toContain('Ingress-public');
        expect(tls!.target).toContain('Secret-tls-secret');
    });

    it('draws no edge when the referenced Secret is missing from the manifest', () => {
        const { edges } = buildGraph([pod('web', 'ghost')], []);
        expect(edges.filter((e) => e.label === 'uses')).toHaveLength(0);
        expect(edges.filter((e) => e.label === 'tls')).toHaveLength(0);
    });

    it('never synthesizes Secrets', () => {
        const { nodes } = buildGraph([secret('creds')], []);
        const secretNodes = nodes.filter((n) => n.data.kind === 'Secret');
        expect(secretNodes).toHaveLength(1);
        expect(secretNodes[0].data.synthetic).toBeUndefined();
    });
});

describe('secret reference helpers', () => {
    it('getSecretRefs reads secret refs from envFrom, secretKeyRef and volumes', () => {
        const multi: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'multi' },
            spec: {
                containers: [
                    {
                        name: 'app',
                        image: 'nginx:latest',
                        envFrom: [{ secretRef: { name: 'all-keys' } }],
                        env: [{ name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } }],
                    },
                ],
                volumes: [{ name: 'creds', secret: { secretName: 'file-creds' } }],
            },
        };
        expect(getSecretRefs(multi)).toEqual(['all-keys', 'db', 'file-creds']);
        expect(getSecretRefs(pod('web'))).toEqual([]);
    });

    it('getSecretRefDetails reports the mechanism per reference', () => {
        const multi: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'multi' },
            spec: {
                containers: [
                    {
                        name: 'app',
                        image: 'nginx:latest',
                        env: [{ name: 'DB_PASS', valueFrom: { secretKeyRef: { name: 'db', key: 'password' } } }],
                    },
                ],
                volumes: [{ name: 'creds', secret: { secretName: 'file-creds' } }],
            },
        };
        expect(getSecretRefDetails(multi)).toEqual([
            { name: 'db', mechanism: 'envKey', key: 'password' },
            { name: 'file-creds', mechanism: 'volumes' },
        ]);
    });

    it('getIngressTlsSecretNames reads spec.tls[].secretName and de-dupes', () => {
        const multi: K8sResource = {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'Ingress',
            metadata: { name: 'multi' },
            spec: {
                tls: [
                    { secretName: 'a', hosts: ['x.com'] },
                    { secretName: 'a', hosts: ['y.com'] },
                    { secretName: 'b' },
                ],
            },
        };
        expect(getIngressTlsSecretNames(multi)).toEqual(['a', 'b']);
    });
});

describe('secret link semantics', () => {
    it('linkSecretToWorkload writes envFrom[].secretRef', () => {
        const resources = [pod('web'), secret('creds')];
        const result = linkSecretToWorkload(resources, 1, 0, 'envFrom');
        const podSpec = result.resources[0].spec as any;
        expect(podSpec.containers[0].envFrom).toEqual([{ secretRef: { name: 'creds' } }]);
    });

    it('linkSecretToWorkload writes volumes[].secret.secretName with a volume name', () => {
        const resources = [pod('web'), secret('creds')];
        const result = linkSecretToWorkload(resources, 1, 0, 'volumes', undefined, 'my-secret-vol');
        const podSpec = result.resources[0].spec as any;
        expect(podSpec.volumes).toEqual([
            { name: 'my-secret-vol', secret: { secretName: 'creds' } },
        ]);
    });

    it('linkSecretToWorkload writes env[].valueFrom.secretKeyRef', () => {
        const resources = [pod('web'), secret('creds')];
        const result = linkSecretToWorkload(resources, 1, 0, 'envKey', 'password');
        const podSpec = result.resources[0].spec as any;
        expect(podSpec.containers[0].env).toEqual([
            { name: 'password', valueFrom: { secretKeyRef: { name: 'creds', key: 'password' } } },
        ]);
    });

    it('linkSecretToWorkload writes into the pod template of a Deployment', () => {
        const resources = [deployment('api'), secret('creds')];
        const result = linkSecretToWorkload(resources, 1, 0, 'envFrom');
        const templateSpec = (result.resources[0].spec as any).template.spec;
        expect(templateSpec.containers[0].envFrom).toEqual([{ secretRef: { name: 'creds' } }]);
    });

    it('linkIngressToSecret writes spec.tls[].secretName with hosts', () => {
        const resources = [ingress('public'), secret('tls-secret')];
        const result = linkIngressToSecret(resources, 0, 1, ['a.example.com', 'b.example.com']);
        const spec = result.resources[0].spec as any;
        expect(spec.tls).toEqual([
            { secretName: 'tls-secret', hosts: ['a.example.com', 'b.example.com'] },
        ]);
    });

    it('linkIngressToSecret merges into an existing tls entry for the same secret', () => {
        const resources = [ingress('public', 'tls-secret'), secret('tls-secret')];
        const result = linkIngressToSecret(resources, 0, 1, ['new.example.com']);
        const spec = result.resources[0].spec as any;
        expect(spec.tls).toEqual([{ secretName: 'tls-secret', hosts: ['new.example.com'] }]);
    });

    it('explainInvalidLink rejects non-Pod-spec Secret pairs with guidance', () => {
        expect(explainInvalidLink('Secret', 'Service')).toContain('Pod spec');
        expect(explainInvalidLink('Secret', 'HorizontalPodAutoscaler')).toContain('HorizontalPodAutoscaler');
        expect(explainInvalidLink('Secret', 'ConfigMap')).toContain('Pod spec');
        expect(explainInvalidLink('Secret', 'Secret')).toContain('Pod spec');
    });
});
