import type { SupportedKind } from '../types/types';

/**
 * Kubernetes resource kinds that live at the cluster scope: they never belong to
 * a namespace (no metadata.namespace), so the canvas renders them inside the
 * cluster rectangle but OUTSIDE any namespace rectangle, and the create
 * modal / inspector hide the namespace field for them.
 */
export const CLUSTER_SCOPED_KINDS: readonly SupportedKind[] = [
    'PersistentVolume',
    'StorageClass',
];

/** True when the kind is cluster-scoped (PV / StorageClass). */
export function isClusterScoped(kind: SupportedKind | string): boolean {
    return (CLUSTER_SCOPED_KINDS as readonly string[]).includes(kind);
}
