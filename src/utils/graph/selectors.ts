import type { K8sResource } from '../../types/types';
import { SINGLE_NODE_ACCESS_MODES } from './graphTypes';

/** Deterministic pod-template-hash-style suffix so synthetic names are stable across rebuilds. */
export function shortHash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
        h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
    }
    return h.toString(36).slice(0, 5).padEnd(5, '0');
}

/** Desired replica count of a workload (Kubernetes defaults to 1 when unset). */
export function replicasOf(resource: K8sResource): number {
    const spec = resource.spec as { replicas?: unknown } | undefined;
    const n = spec?.replicas;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return Math.floor(n);
    return 1;
}

/** Number of Pods a Job runs at the same time (spec.parallelism, defaults to 1 when unset). */
export function parallelismOf(resource: K8sResource): number {
    const spec = resource.spec as { parallelism?: unknown } | undefined;
    const n = spec?.parallelism;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

/** Number of Pods a CronJob's Job runs at the same time (spec.jobTemplate.spec.parallelism, defaults to 1 when unset). */
export function cronParallelismOf(resource: K8sResource): number {
    const spec = resource.spec as { jobTemplate?: { spec?: { parallelism?: unknown } } } | undefined;
    const n = spec?.jobTemplate?.spec?.parallelism;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 1) return Math.floor(n);
    return 1;
}

/** True when the PVC's first access mode is single-node (RWO/RWOP). */
export function isSingleNodeAccessMode(pvc: K8sResource): boolean {
    const spec = pvc.spec as { accessModes?: unknown } | undefined;
    const modes = spec?.accessModes;
    const first = Array.isArray(modes) ? modes[0] : modes;
    return typeof first === 'string' && SINGLE_NODE_ACCESS_MODES.has(first);
}

/** True when `parent` should own `child` (K8s controller semantics, approximated). */
export function ownsResource(parent: K8sResource, child: K8sResource): boolean {
    const nameMatch = startsWithResourceName(child.metadata.name, parent.metadata.name);
    const selector = getSelector(parent);
    const labels = getTargetLabels(child);
    const selectorMatch = !!(selector && labels && matchesSelector(selector, labels));
    // Fallback: match by shared metadata.labels when no explicit selector is set
    const labelFallback = !selector && sharesLabel(parent.metadata?.labels, child.metadata?.labels);
    return nameMatch || selectorMatch || labelFallback;
}

export function startsWithResourceName(name: string, parentName: string): boolean {
    return name === parentName || name.startsWith(`${parentName}-`);
}

export function sharesLabel(
    aLabels: Record<string, string> | undefined,
    bLabels: Record<string, string> | undefined
): boolean {
    if (!aLabels || !bLabels) return false;
    return Object.entries(aLabels).some(([k, v]) => bLabels[k] === v);
}

export function getSelector(resource: K8sResource): Record<string, string> | undefined {
    const spec = resource.spec as { selector?: Record<string, string> } | undefined;
    // Handle standard spec.selector.matchLabels OR legacy selector
    if (spec?.selector && 'matchLabels' in spec.selector) {
        return (spec.selector as { matchLabels?: Record<string, string> }).matchLabels;
    }
    return spec?.selector;
}

export function getTargetLabels(resource: K8sResource): Record<string, string> | undefined {
    const metadataLabels = resource.metadata?.labels;
    const spec = resource.spec as
        | { template?: { metadata?: { labels?: Record<string, string> } } }
        | undefined;
    return metadataLabels ?? spec?.template?.metadata?.labels;
}

/** The labels the pods created by a workload would carry (template first, then selector, then metadata).
 *  CronJobs carry the pod template labels under spec.jobTemplate.spec.template. */
export function getWorkloadPodLabels(resource: K8sResource): Record<string, string> | undefined {
    const spec = resource.spec as
        | {
              template?: { metadata?: { labels?: Record<string, string> } };
              jobTemplate?: { spec?: { template?: { metadata?: { labels?: Record<string, string> } } } };
          }
        | undefined;
    if (resource.kind === 'CronJob') {
        return (
            spec?.jobTemplate?.spec?.template?.metadata?.labels ??
            getSelector(resource) ??
            resource.metadata?.labels
        );
    }
    return spec?.template?.metadata?.labels ?? getSelector(resource) ?? resource.metadata?.labels;
}

/**
 * The Pod spec of a resource: `spec` for Pods, `spec.template.spec` for
 * Deployment/ReplicaSet/Job, and `spec.jobTemplate.spec.template.spec` for
 * CronJobs (their Pods are described inside the Job template).
 */
export function podSpecOf(resource: K8sResource): Record<string, any> | undefined {
    const spec = resource.spec as Record<string, any> | undefined;
    if (resource.kind === 'Pod') return spec;
    if (resource.kind === 'CronJob') return spec?.jobTemplate?.spec?.template?.spec;
    return spec?.template?.spec;
}

export function matchesSelector(
    selector: Record<string, string>,
    labels: Record<string, string> | undefined
): boolean {
    if (!labels || Object.keys(selector).length === 0) return false;
    return Object.entries(selector).every(([k, v]) => labels[k] === v);
}
