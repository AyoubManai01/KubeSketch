import type { K8sResource } from '../../types/types';
import { podSpecOf } from './selectors';

/**
 * The ConfigMap names a resource references through its Pod spec: `envFrom[].configMapRef`,
 * `env[].valueFrom.configMapKeyRef` and `volumes[].configMap`. Workloads (Deployment/ReplicaSet)
 * carry these under `spec.template.spec`; Pods use `spec` directly. Returns unique names in
 * document order.
 */
export function getConfigMapRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const names = new Set<string>();
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];

    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.configMapRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const name = env?.valueFrom?.configMapKeyRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
    });

    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.configMap?.name;
            if (typeof name === 'string') names.add(name);
        });
    }

    return [...names];
}

/**
 * The PersistentVolumeClaim names a resource references through its Pod spec:
 * `volumes[].persistentVolumeClaim.claimName`. Workloads (Deployment/ReplicaSet)
 * carry them under `spec.template.spec`; Pods use `spec` directly. Returns unique
 * claim names in document order.
 */
export function getPvcRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec || !Array.isArray(podSpec.volumes)) return [];

    const names: string[] = [];
    const seen = new Set<string>();
    podSpec.volumes.forEach((volume: any) => {
        const name = volume?.persistentVolumeClaim?.claimName;
        if (typeof name === 'string' && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    });
    return names;
}

/** All real workloads/Pods that reference the given PVC by claimName (via getPvcRefs). */
export function getResourcesUsingPvc(resources: K8sResource[], claimName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getPvcRefs(r).includes(claimName));
}

/** How a resource claims each PVC it references: the volume name + claim name, for the inspector. */
export function getPvcRefDetails(resource: K8sResource): Array<{ name: string; volumeName: string }> {
    const podSpec = podSpecOf(resource);
    if (!podSpec || !Array.isArray(podSpec.volumes)) return [];

    const entries: Array<{ name: string; volumeName: string }> = [];
    const seen = new Set<string>();
    podSpec.volumes.forEach((volume: any) => {
        const name = volume?.persistentVolumeClaim?.claimName;
        if (typeof name !== 'string' || seen.has(name)) return;
        seen.add(name);
        entries.push({ name, volumeName: typeof volume?.name === 'string' ? volume.name : '' });
    });
    return entries;
}

/** The PV a PVC binds to by name (from spec.volumeName), or undefined when unbound. */
export function getPvForPvc(pvc: K8sResource): string | undefined {
    const spec = pvc.spec as { volumeName?: unknown } | undefined;
    return typeof spec?.volumeName === 'string' && spec.volumeName ? spec.volumeName : undefined;
}

/** The StorageClass a PVC references (from spec.storageClassName), or undefined. */
export function getStorageClassForPvc(pvc: K8sResource): string | undefined {
    const spec = pvc.spec as { storageClassName?: unknown } | undefined;
    return typeof spec?.storageClassName === 'string' && spec.storageClassName
        ? spec.storageClassName
        : undefined;
}

/** All PVCs bound to the given PV by name (spec.volumeName). */
export function getPvcsBoundToPv(resources: K8sResource[], pvName: string): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'PersistentVolumeClaim' && getPvForPvc(r) === pvName
    );
}

/** All PVCs referencing the given StorageClass by name (spec.storageClassName). */
export function getPvcsBoundToStorageClass(
    resources: K8sResource[],
    scName: string
): K8sResource[] {
    return resources.filter(
        (r) => r.kind === 'PersistentVolumeClaim' && getStorageClassForPvc(r) === scName
    );
}

/** All resources that reference the given ConfigMap by name (via getConfigMapRefs). */
export function getResourcesUsingConfigMap(resources: K8sResource[], cmName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getConfigMapRefs(r).includes(cmName));
}

/**
 * How a resource consumes each ConfigMap it references, for inspector display:
 * `envFrom` (inject all keys), `envKey` (single key via configMapKeyRef, with the
 * key), `volumes` (mounted as a volume). One entry per mechanism per ConfigMap.
 */
export function getConfigMapRefDetails(resource: K8sResource): Array<{
    name: string;
    mechanism: 'envFrom' | 'envKey' | 'volumes';
    key?: string;
}> {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const entries: Array<{ name: string; mechanism: 'envFrom' | 'envKey' | 'volumes'; key?: string }> = [];
    const seen = new Set<string>();
    const push = (name: string, mechanism: 'envFrom' | 'envKey' | 'volumes', key?: string) => {
        const id = `${name}:${mechanism}:${key ?? ''}`;
        if (seen.has(id)) return;
        seen.add(id);
        entries.push({ name, mechanism, ...(key ? { key } : {}) });
    };

    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.configMapRef?.name;
                if (typeof name === 'string') push(name, 'envFrom');
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const ref = env?.valueFrom?.configMapKeyRef;
                if (typeof ref?.name === 'string') push(ref.name, 'envKey', ref.key);
            });
        }
    });
    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.configMap?.name;
            if (typeof name === 'string') push(name, 'volumes');
        });
    }
    return entries;
}

/**
 * The Secret names a resource references through its Pod spec: `envFrom[].secretRef`,
 * `env[].valueFrom.secretKeyRef` and `volumes[].secret.secretName`. Workloads
 * (Deployment/ReplicaSet) carry these under `spec.template.spec`; Pods use `spec`
 * directly. Returns unique names in document order.
 */
export function getSecretRefs(resource: K8sResource): string[] {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const names = new Set<string>();
    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];

    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.secretRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const name = env?.valueFrom?.secretKeyRef?.name;
                if (typeof name === 'string') names.add(name);
            });
        }
    });

    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.secret?.secretName;
            if (typeof name === 'string') names.add(name);
        });
    }

    return [...names];
}

/**
 * How a resource consumes each Secret it references, for inspector display:
 * `envFrom` (inject all keys), `envKey` (single key via secretKeyRef, with the
 * key), `volumes` (mounted as a volume). One entry per mechanism per Secret.
 */
export function getSecretRefDetails(resource: K8sResource): Array<{
    name: string;
    mechanism: 'envFrom' | 'envKey' | 'volumes';
    key?: string;
}> {
    const podSpec = podSpecOf(resource);
    if (!podSpec) return [];

    const entries: Array<{ name: string; mechanism: 'envFrom' | 'envKey' | 'volumes'; key?: string }> = [];
    const seen = new Set<string>();
    const push = (name: string, mechanism: 'envFrom' | 'envKey' | 'volumes', key?: string) => {
        const id = `${name}:${mechanism}:${key ?? ''}`;
        if (seen.has(id)) return;
        seen.add(id);
        entries.push({ name, mechanism, ...(key ? { key } : {}) });
    };

    const containers: any[] = [
        ...(Array.isArray(podSpec.containers) ? podSpec.containers : []),
        ...(Array.isArray(podSpec.initContainers) ? podSpec.initContainers : []),
    ];
    containers.forEach((container) => {
        if (!container || typeof container !== 'object') return;
        if (Array.isArray(container.envFrom)) {
            container.envFrom.forEach((envFrom: any) => {
                const name = envFrom?.secretRef?.name;
                if (typeof name === 'string') push(name, 'envFrom');
            });
        }
        if (Array.isArray(container.env)) {
            container.env.forEach((env: any) => {
                const ref = env?.valueFrom?.secretKeyRef;
                if (typeof ref?.name === 'string') push(ref.name, 'envKey', ref.key);
            });
        }
    });
    if (Array.isArray(podSpec.volumes)) {
        podSpec.volumes.forEach((volume: any) => {
            const name = volume?.secret?.secretName;
            if (typeof name === 'string') push(name, 'volumes');
        });
    }
    return entries;
}

/** All real workloads/Pods that reference the given Secret by name (via getSecretRefs). */
export function getResourcesUsingSecret(resources: K8sResource[], secretName: string): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'Deployment' ||
            r.kind === 'ReplicaSet' ||
            r.kind === 'Pod' ||
            r.kind === 'Job' ||
            r.kind === 'CronJob'
    ).filter((r) => getSecretRefs(r).includes(secretName));
}
