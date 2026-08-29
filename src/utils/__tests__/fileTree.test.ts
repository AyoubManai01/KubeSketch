import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import type { K8sResource } from '../../types/types';
import type { K8sNodeData } from '../buildGraph';
import {
    buildFileExplorer,
    buildFileTree,
    computeFileOf,
    fileViewOf,
} from '../fileTree';

function dep(name: string, ns = 'default', app = name): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, namespace: ns, labels: { app } },
        spec: {
            replicas: 2,
            selector: { matchLabels: { app } },
            template: {
                metadata: { labels: { app } },
                spec: { containers: [{ name: 'c', image: 'img' }] },
            },
        },
    };
}

function depWithRefs(name: string, opts: { cm?: string; secret?: string; pvc?: string } = {}): K8sResource {
    const base = dep(name);
    const podSpec = (base.spec as any).template.spec;
    if (opts.cm) podSpec.containers[0].envFrom = [{ configMapRef: { name: opts.cm } }];
    if (opts.secret) {
        podSpec.containers[0].envFrom = [
            ...(podSpec.containers[0].envFrom ?? []),
            { secretRef: { name: opts.secret } },
        ];
    }
    if (opts.pvc) podSpec.volumes = [{ name: 'data', persistentVolumeClaim: { claimName: opts.pvc } }];
    return base;
}

function svc(name: string, app: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace: ns },
        spec: { selector: { app }, ports: [{ port: 80 }] },
    };
}

function ingress(name: string, backendService: string, tlsSecret?: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name, namespace: ns },
        spec: {
            ...(tlsSecret ? { tls: [{ secretName: tlsSecret, hosts: ['a.example.com'] }] } : {}),
            rules: [
                {
                    http: {
                        paths: [
                            {
                                path: '/',
                                pathType: 'Prefix',
                                backend: { service: { name: backendService, port: { number: 80 } } },
                            },
                        ],
                    },
                },
            ],
        },
    };
}

function hpa(name: string, target: { kind: string; name: string }, ns = 'default'): K8sResource {
    return {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name, namespace: ns },
        spec: {
            scaleTargetRef: { apiVersion: 'apps/v1', kind: target.kind, name: target.name },
            minReplicas: 1,
            maxReplicas: 5,
        },
    };
}

function vpa(name: string, target: { kind: string; name: string }, ns = 'default'): K8sResource {
    return {
        apiVersion: 'autoscaling.k8s.io/v1',
        kind: 'VerticalPodAutoscaler',
        metadata: { name, namespace: ns },
        spec: {
            targetRef: { apiVersion: 'apps/v1', kind: target.kind, name: target.name },
            updatePolicy: { updateMode: 'Auto' },
        },
    };
}

function cm(name: string, ns = 'default'): K8sResource {
    return { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: ns }, data: { k: 'v' } };
}

function secret(name: string, ns = 'default'): K8sResource {
    return { apiVersion: 'v1', kind: 'Secret', metadata: { name, namespace: ns }, data: { u: 'dmFsdWU=' } };
}

function pvc(name: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name, namespace: ns },
        spec: { accessModes: ['ReadWriteOnce'] },
    };
}

function pv(name: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name },
        spec: { capacity: { storage: '1Gi' } },
    };
}

function sc(name: string): K8sResource {
    return {
        apiVersion: 'storage.k8s.io/v1',
        kind: 'StorageClass',
        metadata: { name },
        provisioner: 'kubernetes.io/no-provisioner',
    };
}

function gwc(name: string): K8sResource {
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'GatewayClass',
        metadata: { name },
        spec: { controllerName: 'example.io/gateway' },
    };
}

function gateway(name: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name, namespace: ns },
        spec: {
            gatewayClassName: 'gwc',
            listeners: [{ name: 'http', port: 80, protocol: 'HTTP' }],
        },
    };
}

function route(name: string, backendService: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'HTTPRoute',
        metadata: { name, namespace: ns },
        spec: { parentRefs: [{ name: 'gw' }], backendRefs: [{ name: backendService, port: 80 }] },
    };
}

function cron(name: string, ns = 'default'): K8sResource {
    return {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name, namespace: ns, labels: { app: name } },
        spec: {
            schedule: '* * * * *',
            jobTemplate: {
                spec: {
                    template: {
                        spec: { restartPolicy: 'Never', containers: [{ name: 'c', image: 'img' }] },
                    },
                },
            },
        },
    };
}

function nodesOf(resources: K8sResource[]): Node<K8sNodeData>[] {
    return resources.map((r) => ({
        id: `${r.kind}-${r.metadata.name}`,
        type: 'k8sNode',
        position: { x: 0, y: 0 },
        data: { kind: r.kind, name: r.metadata.name, namespace: r.metadata.namespace, resource: r },
    }));
}

describe('computeFileOf — cluster-scoped kinds', () => {
    it('places PV/StorageClass/GatewayClass under cluster/ with one file per resource', () => {
        const fileOf = computeFileOf([pv('pv-1'), sc('fast'), gwc('gw-class')]);
        expect(fileOf.get('PersistentVolume:pv-1')).toBe('cluster/persistent-volumes/pv-1.yaml');
        expect(fileOf.get('StorageClass:fast')).toBe('cluster/storage-classes/fast.yaml');
        expect(fileOf.get('GatewayClass:gw-class')).toBe('cluster/gateway-classes/gw-class.yaml');
    });
});

describe('computeFileOf — app-centric grouping', () => {
    it('groups a full app stack into one app folder with per-kind files', () => {
        const resources = [
            depWithRefs('my-app', { cm: 'my-app-config', secret: 'my-app-secret', pvc: 'my-app-data' }),
            svc('my-app-svc', 'my-app'),
            ingress('my-app-ingress', 'my-app-svc', 'my-app-tls'),
            secret('my-app-tls'),
            hpa('my-app-hpa', { kind: 'Deployment', name: 'my-app' }),
            vpa('my-app-vpa', { kind: 'Deployment', name: 'my-app' }),
            cm('my-app-config'),
            secret('my-app-secret'),
            pvc('my-app-data'),
        ];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('Deployment:my-app')).toBe('default/my-app/deployment.yaml');
        expect(fileOf.get('Service:my-app-svc')).toBe('default/my-app/service.yaml');
        expect(fileOf.get('Ingress:my-app-ingress')).toBe('default/my-app/ingress.yaml');
        expect(fileOf.get('ConfigMap:my-app-config')).toBe('default/my-app/configmap.yaml');
        expect(fileOf.get('Secret:my-app-secret')).toBe('default/my-app/secret.yaml');
        expect(fileOf.get('PersistentVolumeClaim:my-app-data')).toBe('default/my-app/pvc.yaml');
    });

    it('bundles autoscalers with the workload they target', () => {
        const resources = [
            dep('my-app'),
            hpa('my-app-hpa', { kind: 'Deployment', name: 'my-app' }),
            vpa('my-app-vpa', { kind: 'Deployment', name: 'my-app' }),
        ];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('HorizontalPodAutoscaler:my-app-hpa')).toBe('default/my-app/deployment.yaml');
        expect(fileOf.get('VerticalPodAutoscaler:my-app-vpa')).toBe('default/my-app/deployment.yaml');
    });

    it('sends a TLS-only Secret to ingress.yaml and a pod-referenced one to secret.yaml', () => {
        const resources = [
            depWithRefs('app', { secret: 'creds' }),
            svc('app-svc', 'app'),
            ingress('app-ing', 'app-svc', 'creds'),
            secret('creds'),
        ];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('Secret:creds')).toBe('default/app/secret.yaml');
    });

    it('groups workloads sharing an app label into the same app', () => {
        const resources = [dep('frontend', 'default', 'shop'), dep('frontend-worker', 'default', 'shop')];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('Deployment:frontend')).toBe('default/shop/deployment.yaml');
        expect(fileOf.get('Deployment:frontend-worker')).toBe('default/shop/deployment.yaml');
    });

    it('keeps namespaces apart', () => {
        const resources = [dep('worker', 'team-a'), svc('worker-svc', 'worker', 'team-a')];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('Deployment:worker')).toBe('team-a/worker/deployment.yaml');
        expect(fileOf.get('Service:worker-svc')).toBe('team-a/worker/service.yaml');
    });

    it('gives standalone ReplicaSets and Pods their own app files', () => {
        const rs: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'ReplicaSet',
            metadata: { name: 'rs-1' },
            spec: {
                replicas: 1,
                selector: { matchLabels: { app: 'rs-1' } },
                template: { metadata: { labels: { app: 'rs-1' } }, spec: {} },
            },
        };
        const pod: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'p-1' },
            spec: { containers: [{ name: 'c', image: 'img' }] },
        };
        const fileOf = computeFileOf([rs, pod]);
        expect(fileOf.get('ReplicaSet:rs-1')).toBe('default/rs-1/replicaset.yaml');
        expect(fileOf.get('Pod:p-1')).toBe('default/p-1/pod.yaml');
    });

    it('groups CronJobs (and their VPAs) under cronjob.yaml', () => {
        const resources = [cron('backup'), vpa('backup-vpa', { kind: 'CronJob', name: 'backup' })];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('CronJob:backup')).toBe('default/backup/cronjob.yaml');
        expect(fileOf.get('VerticalPodAutoscaler:backup-vpa')).toBe('default/backup/cronjob.yaml');
    });
});

describe('computeFileOf — shared and orphaned resources', () => {
    it('assigns a shared ConfigMap to the first app in sorted order', () => {
        const resources = [
            depWithRefs('a-app', { cm: 'shared' }),
            depWithRefs('b-app', { cm: 'shared' }),
            cm('shared'),
        ];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('ConfigMap:shared')).toBe('default/a-app/configmap.yaml');
    });

    it('puts an unreferenced ConfigMap in _misc grouped by kind', () => {
        const fileOf = computeFileOf([cm('standalone')]);
        expect(fileOf.get('ConfigMap:standalone')).toBe('default/_misc/configmap.yaml');
    });

    it('never binds Gateways to an app — they live in _gateway/', () => {
        const fileOf = computeFileOf([gateway('gw')]);
        expect(fileOf.get('Gateway:gw')).toBe('default/_gateway/gw.yaml');
    });

    it('joins a Route to the app of its backend Service', () => {
        const resources = [dep('app'), svc('app-svc', 'app'), route('app-route', 'app-svc')];
        const fileOf = computeFileOf(resources);
        expect(fileOf.get('HTTPRoute:app-route')).toBe('default/app/route.yaml');
    });

    it('sends an orphaned Route to _misc/route.yaml', () => {
        const fileOf = computeFileOf([route('lonely-route', 'missing-svc')]);
        expect(fileOf.get('HTTPRoute:lonely-route')).toBe('default/_misc/route.yaml');
    });
});

describe('buildFileTree', () => {
    it('orders cluster first, then namespaces, then files inside an app', () => {
        const resources = [pv('pv-1'), dep('app'), cm('orphan')];
        const tree = buildFileTree(computeFileOf(resources));
        expect(tree.children?.map((c) => c.name)).toEqual(['cluster', 'default']);
        const ns = tree.children?.find((c) => c.name === 'default');
        expect(ns?.children?.map((c) => c.name)).toEqual(['app', '_misc']);
        const app = ns?.children?.find((c) => c.name === 'app');
        expect(app?.children?.map((c) => c.name)).toEqual(['deployment.yaml']);
        expect(app?.count).toBe(1);
        expect(ns?.count).toBe(2);
    });
});

describe('buildFileExplorer', () => {
    it('filters synthetic nodes and maps every real resource to a file', () => {
        const resources = [dep('app'), svc('app-svc', 'app')];
        const synthetic: Node<K8sNodeData> = {
            id: 'ReplicaSet-app-abc12',
            type: 'k8sNode',
            position: { x: 0, y: 0 },
            data: {
                kind: 'ReplicaSet',
                name: 'app-abc12',
                resource: {
                    apiVersion: 'apps/v1',
                    kind: 'ReplicaSet',
                    metadata: { name: 'app-abc12' },
                },
                synthetic: true,
                managedBy: { kind: 'Deployment', name: 'app' },
            },
        };
        const { tree, fileOf } = buildFileExplorer([...nodesOf(resources), synthetic]);
        expect(fileOf.size).toBe(2);
        expect(fileOf.get('Deployment:app')).toBe('default/app/deployment.yaml');
        expect(fileOf.get('Service:app-svc')).toBe('default/app/service.yaml');
        expect(tree.children?.[0].name).toBe('default');
    });
});

describe('fileViewOf', () => {
    it('returns the canonical text of a valid file and null for a missing one', () => {
        const resources = [dep('app'), svc('app-svc', 'app')];
        const view = fileViewOf(resources, 'default/app/deployment.yaml');
        expect(view.activeFile).toBe('default/app/deployment.yaml');
        expect(view.activeFileText).toContain('kind: Deployment');
        expect(fileViewOf(resources, 'default/nope/x.yaml').activeFile).toBeNull();
        expect(fileViewOf(resources, null).activeFile).toBeNull();
    });
});