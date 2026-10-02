import type { ConfigMapLinkPayload, IngressTlsPayload, PvcLinkPayload, SecretLinkPayload } from '../../store/store';
import type { K8sResource, SupportedKind } from '../../types/types';
import type { CreateFormBundle } from './formTypes';

/** Parse "k=v,k2=v2" into a map (empty input → undefined). */
export function parseKeyValueString(value: string): Record<string, string> | undefined {
    if (!value.trim()) return undefined;
    const obj: Record<string, string> = {};
    value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((pair) => {
            const [k, ...rest] = pair.split('=');
            if (!k || rest.length === 0) return;
            obj[k.trim()] = rest.join('=').trim();
        });
    return Object.keys(obj).length ? obj : undefined;
}

/**
 * Build the K8sResource the form describes, kind by kind. Reads the raw form
 * fields plus the derived fallbacks (suggested name, option lists).
 */
export function buildCreatedResource(
    kind: SupportedKind,
    form: CreateFormBundle
): K8sResource {
    const { state, derived } = form;
    const meta: K8sResource['metadata'] = {
        name: state.name.trim() || derived.suggestedName,
        namespace: state.namespace.trim(),
    };
    if (derived.appLabel.trim()) meta.labels = { app: derived.appLabel.trim() };

    switch (kind) {
        case 'Deployment':
        case 'ReplicaSet': {
            const replicaNum = parseInt(state.replicas, 10);
            const label = derived.appLabel.trim() || meta.name;
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
                            name: state.containerName.trim() || 'app',
                            image: state.containerImage.trim() || 'nginx:latest',
                        },
                    ],
                },
            };
        case 'Service': {
            const portNum = parseInt(state.port, 10);
            const tpNum = parseInt(state.targetPort, 10);
            return {
                apiVersion: 'v1',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec: {
                    type: state.serviceType || 'ClusterIP',
                    ...(derived.appLabel.trim() ? { selector: { app: derived.appLabel.trim() } } : {}),
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
                            ...(state.host.trim() ? { host: state.host.trim() } : {}),
                            http: {
                                paths: [
                                    {
                                        path: state.path.trim() || '/',
                                        pathType: 'Prefix',
                                        ...(state.backendService
                                            ? {
                                                  backend: {
                                                      service: {
                                                          name: state.backendService,
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
        case 'HorizontalPodAutoscaler': {
            const minNum = parseInt(state.minReplicas, 10);
            const maxNum = parseInt(state.maxReplicas, 10);
            const cpuNum = parseInt(state.cpuTarget, 10);
            const [targetKindRaw, targetNameRaw] = state.targetWorkload.split('|');
            const fallback = derived.workloadOptions[0];
            const targetKind = targetKindRaw || fallback?.kind || 'Deployment';
            const targetName = targetNameRaw || fallback?.name || '';
            return {
                apiVersion: 'autoscaling/v2',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec: {
                    scaleTargetRef: {
                        apiVersion: 'apps/v1',
                        kind: targetKind,
                        name: targetName,
                    },
                    minReplicas: Number.isFinite(minNum) ? minNum : 1,
                    maxReplicas: Number.isFinite(maxNum) ? maxNum : 10,
                    metrics: [
                        {
                            type: 'Resource',
                            resource: {
                                name: 'cpu',
                                target: {
                                    type: 'Utilization',
                                    averageUtilization: Number.isFinite(cpuNum) ? cpuNum : 70,
                                },
                            },
                        },
                    ],
                },
            };
        }
        case 'ConfigMap': {
            const labels = parseKeyValueString(state.cmLabels);
            const annotations = parseKeyValueString(state.cmAnnotations);
            return {
                apiVersion: 'v1',
                kind,
                metadata: {
                    name: meta.name,
                    namespace: meta.namespace,
                    ...(labels ? { labels } : {}),
                    ...(annotations ? { annotations } : {}),
                },
                ...(state.cmData ? { data: state.cmData } : {}),
            };
        }
        case 'Secret': {
            const labels = parseKeyValueString(state.secretLabels);
            const annotations = parseKeyValueString(state.secretAnnotations);
            return {
                apiVersion: 'v1',
                kind,
                metadata: {
                    name: meta.name,
                    namespace: meta.namespace,
                    ...(labels ? { labels } : {}),
                    ...(annotations ? { annotations } : {}),
                },
                ...(state.secretData ? { data: state.secretData } : {}),
            };
        }
        case 'PersistentVolumeClaim': {
            return {
                apiVersion: 'v1',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec: {
                    accessModes: [state.pvcAccessModes],
                    resources: { requests: { storage: state.pvcSize.trim() || '1Gi' } },
                },
            };
        }
        case 'PersistentVolume':
            return {
                apiVersion: 'v1',
                kind,
                // PVs are cluster-scoped, so no namespace field.
                metadata: { name: meta.name },
                spec: {
                    capacity: { storage: state.pvCapacity.trim() || '10Gi' },
                    accessModes: [state.pvAccessModes],
                    persistentVolumeReclaimPolicy: state.pvReclaimPolicy,
                },
            };
        case 'StorageClass':
            return {
                apiVersion: 'storage.k8s.io/v1',
                kind,
                // StorageClasses are cluster-scoped, so no namespace field.
                metadata: { name: meta.name },
                spec: {
                    provisioner: state.scProvisioner.trim() || 'kubernetes.io/no-provisioner',
                    ...(state.scReclaimPolicy ? { reclaimPolicy: state.scReclaimPolicy } : {}),
                },
            };
        case 'Job': {
            const parallelismNum = parseInt(state.parallelism, 10);
            const completionsNum = parseInt(state.completions, 10);
            const label = derived.appLabel.trim() || meta.name;
            return {
                apiVersion: 'batch/v1',
                kind,
                metadata: { ...meta, labels: { app: label } },
                spec: {
                    parallelism:
                        Number.isFinite(parallelismNum) && parallelismNum > 0 ? parallelismNum : 1,
                    completions:
                        Number.isFinite(completionsNum) && completionsNum > 0 ? completionsNum : 1,
                    selector: { matchLabels: { app: label } },
                    template: {
                        metadata: { labels: { app: label } },
                        spec: {
                            restartPolicy: state.restartPolicy || 'OnFailure',
                            containers: [
                                {
                                    name: state.containerName.trim() || 'app',
                                    image: state.containerImage.trim() || 'nginx:latest',
                                },
                            ],
                        },
                    },
                },
            };
        }
        case 'CronJob': {
            const parallelismNum = parseInt(state.parallelism, 10);
            const completionsNum = parseInt(state.completions, 10);
            const label = derived.appLabel.trim() || meta.name;
            const shellCmd = state.shellCommand.trim();
            return {
                apiVersion: 'batch/v1',
                kind,
                metadata: { ...meta, labels: { app: label } },
                spec: {
                    schedule: state.schedule.trim() || '* * * * *',
                    jobTemplate: {
                        spec: {
                            parallelism:
                                Number.isFinite(parallelismNum) && parallelismNum > 0
                                    ? parallelismNum
                                    : 1,
                            completions:
                                Number.isFinite(completionsNum) && completionsNum > 0
                                    ? completionsNum
                                    : 1,
                            selector: { matchLabels: { app: label } },
                            template: {
                                metadata: { labels: { app: label } },
                                spec: {
                                    restartPolicy: state.restartPolicy || 'OnFailure',
                                    containers: [
                                        {
                                            name: state.containerName.trim() || 'app',
                                            image: state.containerImage.trim() || 'nginx:latest',
                                            ...(state.shellCommandEnabled && shellCmd
                                                ? { command: ['/bin/sh', '-c'], args: [shellCmd] }
                                                : {}),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            };
        }
        case 'VerticalPodAutoscaler': {
            const [targetKindRaw, targetNameRaw] = state.vpaTarget.split('|');
            const fallback = derived.vpaTargetOptions[0];
            const targetKind = targetKindRaw || fallback?.kind || 'Deployment';
            const targetName = targetNameRaw || fallback?.name || '';
            const targetApiVersion =
                targetKind === 'Deployment' || targetKind === 'ReplicaSet'
                    ? 'apps/v1'
                    : targetKind === 'Job' || targetKind === 'CronJob'
                    ? 'batch/v1'
                    : 'v1';
            const minAllowed: Record<string, string> = {};
            const maxAllowed: Record<string, string> = {};
            if (state.vpaMinCpu.trim()) minAllowed.cpu = state.vpaMinCpu.trim();
            if (state.vpaMinMemory.trim()) minAllowed.memory = state.vpaMinMemory.trim();
            if (state.vpaMaxCpu.trim()) maxAllowed.cpu = state.vpaMaxCpu.trim();
            if (state.vpaMaxMemory.trim()) maxAllowed.memory = state.vpaMaxMemory.trim();
            const hasBounds =
                Object.keys(minAllowed).length > 0 || Object.keys(maxAllowed).length > 0;
            return {
                apiVersion: 'autoscaling.k8s.io/v1',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec: {
                    targetRef: {
                        apiVersion: targetApiVersion,
                        kind: targetKind,
                        name: targetName,
                    },
                    updatePolicy: { updateMode: state.vpaUpdateMode },
                    ...(hasBounds
                        ? {
                              resourcePolicy: {
                                  containerPolicies: [
                                      {
                                          containerName: '*',
                                          ...(Object.keys(minAllowed).length
                                              ? { minAllowed }
                                              : {}),
                                          ...(Object.keys(maxAllowed).length
                                              ? { maxAllowed }
                                              : {}),
                                      },
                                  ],
                              },
                          }
                        : {}),
                },
            };
        }
        case 'GatewayClass':
            return {
                apiVersion: 'gateway.networking.k8s.io/v1',
                kind,
                // GatewayClasses are cluster-scoped, so no namespace field.
                metadata: { name: meta.name },
                spec: {
                    controllerName:
                        state.gcControllerName.trim() || 'acme.io/gateway-controller',
                },
            };
        case 'Gateway':
            return {
                apiVersion: 'gateway.networking.k8s.io/v1',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec: {
                    ...(state.gwClassName
                        ? { gatewayClassName: state.gwClassName }
                        : { gatewayClassName: '' }),
                    listeners: [],
                },
            };
        case 'HTTPRoute':
        case 'GRPCRoute':
        case 'TCPRoute':
        case 'TLSRoute':
        case 'UDPRoute': {
            const spec: Record<string, unknown> = {};
            if (state.routeParentGateway) {
                spec.parentRefs = [{ name: state.routeParentGateway }];
            }
            if (state.routeHostnames.trim() && kind !== 'TCPRoute' && kind !== 'UDPRoute') {
                spec.hostnames = state.routeHostnames
                    .split(/[\s,]+/)
                    .map((h) => h.trim())
                    .filter(Boolean);
            }
            if (state.routeBackendService) {
                spec.backendRefs = [{ name: state.routeBackendService }];
            }
            return {
                apiVersion: 'gateway.networking.k8s.io/v1',
                kind,
                metadata: { name: meta.name, namespace: meta.namespace },
                spec,
            };
        }
    }
}

export type CreatedResourceLink =
    | ConfigMapLinkPayload
    | PvcLinkPayload
    | SecretLinkPayload
    | IngressTlsPayload;

/**
 * Assemble the optional link payload (ConfigMap/Secret mechanism, Ingress TLS,
 * PVC mount/bind) that the store applies in the same commit as the creation.
 * Returns undefined when the form picked no link.
 */
export function buildCreatedResourceLink(
    kind: SupportedKind,
    form: CreateFormBundle
): CreatedResourceLink | undefined {
    const { state } = form;
    let link: CreatedResourceLink | undefined;
    if (state.cmTarget) {
        const [targetKind, targetName] = state.cmTarget.split('|');
        link = {
            targetKind: targetKind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
            targetName,
            mechanism: state.cmMechanism,
            ...(state.cmMechanism === 'envKey' && state.cmKey ? { key: state.cmKey } : {}),
        };
    }
    if (kind === 'Secret' && state.secretTarget) {
        const [targetKind, targetName] = state.secretTarget.split('|');
        link = {
            targetKind: targetKind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
            targetName,
            mechanism: state.secretMechanism,
            ...(state.secretMechanism === 'envKey' && state.secretKey ? { key: state.secretKey } : {}),
            ...(state.secretMechanism === 'volumes' && state.secretVolumeName.trim()
                ? { volumeName: state.secretVolumeName.trim() }
                : {}),
        };
    }
    if (kind === 'Ingress' && state.ingressTlsSecret) {
        link = {
            secretName: state.ingressTlsSecret,
            hosts: state.ingressTlsHosts
                .split(/[\s,]+/)
                .map((h) => h.trim())
                .filter(Boolean),
        };
    }
    if (kind === 'PersistentVolumeClaim') {
        let mountTarget: PvcLinkPayload['mountTarget'];
        if (state.pvcMountTarget) {
            const [targetKind, targetName] = state.pvcMountTarget.split('|');
            mountTarget = {
                kind: targetKind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
                name: targetName,
                volumeName: state.pvcVolumeName.trim(),
            };
        }
        let bindTarget: PvcLinkPayload['bindTarget'];
        if (state.pvcBindTarget) {
            const [bindKind, bindName] = state.pvcBindTarget.split('|');
            bindTarget = {
                kind: bindKind as 'PersistentVolume' | 'StorageClass',
                name: bindName,
            };
        }
        if (mountTarget || bindTarget) {
            link = { ...(mountTarget ? { mountTarget } : {}), ...(bindTarget ? { bindTarget } : {}) };
        }
    }
    return link;
}