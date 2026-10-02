import { type Node } from '@xyflow/react';
import { isRouteKind, type K8sNodeData } from '../utils/buildGraph';
import type { SupportedKind } from '../types/types';

/** Rewrite Ingress backend references when a Service is renamed. */
export function renameServiceReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Ingress') return n;
        const spec = n.data.resource.spec as {
            rules?: Array<{ http?: { paths?: Array<{ backend?: { service?: { name?: string } } }> } }>;
        } | undefined;
        const referencesService = spec?.rules?.some((rule) =>
            rule.http?.paths?.some((path) => path.backend?.service?.name === oldName)
        );
        if (!referencesService) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as NonNullable<typeof spec>;
        clonedSpec.rules?.forEach((rule) => {
            rule.http?.paths?.forEach((path) => {
                if (path.backend?.service?.name === oldName) {
                    path.backend.service.name = newName;
                }
            });
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite HorizontalPodAutoscaler scaleTargetRef names when a Deployment/ReplicaSet is renamed. */
export function renameWorkloadReferences(
    nodes: Node<K8sNodeData>[],
    kind: 'Deployment' | 'ReplicaSet',
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'HorizontalPodAutoscaler') return n;
        const spec = n.data.resource.spec as
            | { scaleTargetRef?: { kind?: string; name?: string } }
            | undefined;
        const ref = spec?.scaleTargetRef;
        if (!ref || ref.kind !== kind || ref.name !== oldName) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { scaleTargetRef?: { name?: string } };
        if (clonedSpec.scaleTargetRef) {
            clonedSpec.scaleTargetRef.name = newName;
        }
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite VerticalPodAutoscaler spec.targetRef names when their target
 *  (Deployment/ReplicaSet/Pod/Job/CronJob) is renamed. */
export function renameVpaTargetReferences(
    nodes: Node<K8sNodeData>[],
    kind: 'Deployment' | 'ReplicaSet' | 'Pod' | 'Job' | 'CronJob',
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'VerticalPodAutoscaler') return n;
        const spec = n.data.resource.spec as
            | { targetRef?: { kind?: string; name?: string } }
            | undefined;
        const ref = spec?.targetRef;
        if (!ref || ref.kind !== kind || ref.name !== oldName) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { targetRef?: { name?: string } };
        if (clonedSpec.targetRef) {
            clonedSpec.targetRef.name = newName;
        }
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Pod-spec ConfigMap references when a ConfigMap is renamed (envFrom, env.valueFrom, volumes). */
export function renameConfigMapReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        if (!podSpec || !referencesConfigMap(podSpec, oldName)) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        rewriteConfigMapNames(clonedPodSpec, oldName, newName);
        return { ...n, data: { ...n.data, resource } };
    });
}

/** The Pod spec of a node: `spec` for Pods, `spec.template.spec` for workloads,
 *  `spec.jobTemplate.spec.template.spec` for CronJobs. */
function podSpecOfNode(
    kind: SupportedKind,
    spec: Record<string, any> | undefined
): Record<string, any> | undefined {
    if (!spec) return undefined;
    if (kind === 'Pod') return spec;
    if (kind === 'CronJob') return spec.jobTemplate?.spec?.template?.spec;
    return spec.template?.spec;
}

/** True when a Pod spec references the given ConfigMap by name anywhere. */
function referencesConfigMap(podSpec: Record<string, any>, name: string): boolean {
    return configMapRefNames(podSpec).includes(name);
}

/** All ConfigMap names a Pod spec references (envFrom, env.valueFrom, volumes). */
function configMapRefNames(podSpec: Record<string, any>): string[] {
    const names: string[] = [];
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container?.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.configMapRef?.name) names.push(envFrom.configMapRef.name);
        });
        (Array.isArray(container?.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.configMapKeyRef?.name) names.push(env.valueFrom.configMapKeyRef.name);
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.configMap?.name) names.push(volume.configMap.name);
    });
    return names;
}

/** Rewrite every ConfigMap reference inside a Pod spec from oldName to newName. */
function rewriteConfigMapNames(podSpec: Record<string, any>, oldName: string, newName: string) {
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.configMapRef?.name === oldName) envFrom.configMapRef.name = newName;
        });
        (Array.isArray(container.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.configMapKeyRef?.name === oldName) {
                env.valueFrom.configMapKeyRef.name = newName;
            }
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.configMap?.name === oldName) volume.configMap.name = newName;
    });
}

/**
 * Rewrite Secret references when a Secret is renamed: Pod-spec references
 * (envFrom[].secretRef, env[].valueFrom.secretKeyRef, volumes[].secret.secretName)
 * and Ingress spec.tls[].secretName.
 */
export function renameSecretReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind === 'Ingress') {
            const spec = n.data.resource.spec as
                | { tls?: Array<{ secretName?: string }> }
                | undefined;
            if (!spec?.tls?.some((tls) => tls?.secretName === oldName)) return n;
            const resource = structuredClone(n.data.resource);
            const clonedSpec = resource.spec as { tls?: Array<{ secretName?: string }> };
            (Array.isArray(clonedSpec.tls) ? clonedSpec.tls : []).forEach((tls) => {
                if (tls?.secretName === oldName) tls.secretName = newName;
            });
            return { ...n, data: { ...n.data, resource } };
        }
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        if (!podSpec || !referencesSecret(podSpec, oldName)) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        rewriteSecretNames(clonedPodSpec, oldName, newName);
        return { ...n, data: { ...n.data, resource } };
    });
}

/** True when a Pod spec references the given Secret by name anywhere. */
function referencesSecret(podSpec: Record<string, any>, name: string): boolean {
    return secretRefNames(podSpec).includes(name);
}

/** All Secret names a Pod spec references (envFrom, env.valueFrom, volumes). */
function secretRefNames(podSpec: Record<string, any>): string[] {
    const names: string[] = [];
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container?.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.secretRef?.name) names.push(envFrom.secretRef.name);
        });
        (Array.isArray(container?.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.secretKeyRef?.name) names.push(env.valueFrom.secretKeyRef.name);
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.secret?.secretName) names.push(volume.secret.secretName);
    });
    return names;
}

/** Rewrite every Secret reference inside a Pod spec from oldName to newName. */
function rewriteSecretNames(podSpec: Record<string, any>, oldName: string, newName: string) {
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        (Array.isArray(container.envFrom) ? container.envFrom : []).forEach((envFrom: any) => {
            if (envFrom?.secretRef?.name === oldName) envFrom.secretRef.name = newName;
        });
        (Array.isArray(container.env) ? container.env : []).forEach((env: any) => {
            if (env?.valueFrom?.secretKeyRef?.name === oldName) {
                env.valueFrom.secretKeyRef.name = newName;
            }
        });
    });
    (Array.isArray(podSpec.volumes) ? podSpec.volumes : []).forEach((volume: any) => {
        if (volume?.secret?.secretName === oldName) volume.secret.secretName = newName;
    });
}

/** Rewrite Pod-spec PersistentVolumeClaim references when a PVC is renamed
 *  (volumes[].persistentVolumeClaim.claimName). */
export function renamePvcReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Deployment' && n.data.kind !== 'ReplicaSet' && n.data.kind !== 'Pod' && n.data.kind !== 'Job' && n.data.kind !== 'CronJob') {
            return n;
        }
        const spec = n.data.resource.spec as Record<string, any> | undefined;
        const podSpec = podSpecOfNode(n.data.kind, spec);
        const referencesPvc = Array.isArray(podSpec?.volumes) && podSpec.volumes.some(
            (v: any) => v?.persistentVolumeClaim?.claimName === oldName
        );
        if (!referencesPvc) return n;

        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as Record<string, any>;
        const clonedPodSpec = podSpecOfNode(n.data.kind, clonedSpec)!;
        (Array.isArray(clonedPodSpec.volumes) ? clonedPodSpec.volumes : []).forEach((volume: any) => {
            if (volume?.persistentVolumeClaim?.claimName === oldName) {
                volume.persistentVolumeClaim.claimName = newName;
            }
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite PVC spec.volumeName references when a PV is renamed. */
export function renamePvReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'PersistentVolumeClaim') return n;
        const spec = n.data.resource.spec as { volumeName?: string } | undefined;
        if (spec?.volumeName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { volumeName?: string };
        if (clonedSpec.volumeName === oldName) clonedSpec.volumeName = newName;
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite PVC spec.storageClassName references when a StorageClass is renamed. */
export function renameStorageClassReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'PersistentVolumeClaim') return n;
        const spec = n.data.resource.spec as { storageClassName?: string } | undefined;
        if (spec?.storageClassName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { storageClassName?: string };
        if (clonedSpec.storageClassName === oldName) clonedSpec.storageClassName = newName;
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Gateway spec.gatewayClassName references when a GatewayClass is renamed. */
export function renameGatewayClassReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (n.data.kind !== 'Gateway') return n;
        const spec = n.data.resource.spec as { gatewayClassName?: string } | undefined;
        if (spec?.gatewayClassName !== oldName) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { gatewayClassName?: string };
        if (clonedSpec.gatewayClassName === oldName) clonedSpec.gatewayClassName = newName;
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Route spec.parentRefs[].name references when a Gateway is renamed. */
export function renameGatewayReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (!isRouteKind(n.data.kind)) return n;
        const spec = n.data.resource.spec as { parentRefs?: Array<{ name?: string }> } | undefined;
        if (!spec?.parentRefs?.some((ref) => ref?.name === oldName)) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { parentRefs?: Array<{ name?: string }> };
        (Array.isArray(clonedSpec.parentRefs) ? clonedSpec.parentRefs : []).forEach((ref) => {
            if (ref?.name === oldName) ref.name = newName;
        });
        return { ...n, data: { ...n.data, resource } };
    });
}

/** Rewrite Route spec.backendRefs[].name references when a Service is renamed. */
export function renameRouteBackendReferences(
    nodes: Node<K8sNodeData>[],
    oldName: string,
    newName: string
): Node<K8sNodeData>[] {
    return nodes.map((n) => {
        if (!isRouteKind(n.data.kind)) return n;
        const spec = n.data.resource.spec as { backendRefs?: Array<{ name?: string }> } | undefined;
        if (!spec?.backendRefs?.some((ref) => ref?.name === oldName)) return n;
        const resource = structuredClone(n.data.resource);
        const clonedSpec = resource.spec as { backendRefs?: Array<{ name?: string }> };
        (Array.isArray(clonedSpec.backendRefs) ? clonedSpec.backendRefs : []).forEach((ref) => {
            if (ref?.name === oldName) ref.name = newName;
        });
        return { ...n, data: { ...n.data, resource } };
    });
}
