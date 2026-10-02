import type { K8sResource } from '../../types/types';
import { ownsResource, replicasOf } from './selectors';

/** One HorizontalPodAutoscaler-enforced replica clamp on a workload (or on a ReplicaSet inherited from its Deployment). */
export interface HpaReplicaOverride {
    kind: 'Deployment' | 'ReplicaSet';
    name: string;
    original: number;
    effective: number;
    hpaName: string;
    /** Which bound forced the change (for the warning text). */
    reason: 'minReplicas' | 'maxReplicas';
    bound: number;
    /** Set when a ReplicaSet inherited the count from its Deployment's HorizontalPodAutoscaler. */
    viaDeployment?: string;
}

/** The lower/upper bounds a HorizontalPodAutoscaler enforces on a workload (min defaults to 1, max to Infinity). */
function hpaBounds(hpa: K8sResource): { min: number; max: number } | undefined {
    const spec = hpa.spec as { minReplicas?: unknown; maxReplicas?: unknown } | undefined;
    const minRaw = spec?.minReplicas;
    const maxRaw = spec?.maxReplicas;
    const min =
        typeof minRaw === 'number' && Number.isFinite(minRaw) && minRaw >= 0
            ? Math.floor(minRaw)
            : 1;
    const max =
        typeof maxRaw === 'number' && Number.isFinite(maxRaw) && maxRaw >= 0
            ? Math.floor(maxRaw)
            : Infinity;
    return { min, max: Math.max(max, min) };
}

/** True when the HorizontalPodAutoscaler's scaleTargetRef points at this exact workload. */
export function hpaTargets(hpa: K8sResource, resource: K8sResource): boolean {
    const target = getHpaTarget(hpa);
    return !!target && target.kind === resource.kind && target.name === resource.metadata.name;
}

/** The effective replica count a HorizontalPodAutoscaler forces onto a workload: clamp(spec.replicas, [min, max]). */
export function effectiveReplicas(hpa: K8sResource, resource: K8sResource): number | undefined {
    const bounds = hpaBounds(hpa);
    if (!bounds || !hpaTargets(hpa, resource)) return undefined;
    return Math.min(Math.max(replicasOf(resource), bounds.min), bounds.max);
}

/**
 * HorizontalPodAutoscaler priority over `spec.replicas` (HorizontalPodAutoscalers win over Deployments
 * and ReplicaSets). Clamps every targeted workload's replicas into the autoscaler's
 * [minReplicas, maxReplicas] window and WRITES the clamped value back into the
 * workload's spec. YAML, canvas pod count and badges all agree afterwards.
 *
 * A Deployment's HorizontalPodAutoscaler also propagates the effective count to the ReplicaSets it
 * owns (the Deployment controller drives its ReplicaSets' scale). The first
 * matching HorizontalPodAutoscaler wins per workload. Returns the clamps that actually changed a
 * count (used for the persistent bottom status-bar warning).
 */
export function applyHpaReplicaOverrides(resources: K8sResource[]): HpaReplicaOverride[] {
    const hpas = resources.filter((r) => r.kind === 'HorizontalPodAutoscaler');
    if (hpas.length === 0) return [];
    const overrides: HpaReplicaOverride[] = [];

    const clampTo = (
        resource: K8sResource,
        hpa: K8sResource,
        effective: number,
        viaDeployment?: string
    ): void => {
        const original = replicasOf(resource);
        if (effective === original) return;
        const bounds = hpaBounds(hpa)!;
        const reason: HpaReplicaOverride['reason'] =
            effective < original ? 'maxReplicas' : 'minReplicas';
        const bound = reason === 'minReplicas' ? bounds.min : bounds.max;
        const spec = resource.spec as { replicas?: unknown };
        spec.replicas = effective;
        overrides.push({
            kind: resource.kind as 'Deployment' | 'ReplicaSet',
            name: resource.metadata.name,
            original,
            effective,
            hpaName: hpa.metadata.name,
            reason,
            bound,
            viaDeployment,
        });
    };

    resources.forEach((resource) => {
        if (resource.kind !== 'Deployment' && resource.kind !== 'ReplicaSet') return;
        for (const hpa of hpas) {
            const effective = effectiveReplicas(hpa, resource);
            if (effective === undefined) continue;
            clampTo(resource, hpa, effective);
            if (resource.kind === 'Deployment') {
                const depEffective = effective;
                resources.forEach((rs) => {
                    if (rs.kind !== 'ReplicaSet' || !ownsResource(resource, rs)) return;
                    clampTo(rs, hpa, depEffective, resource.metadata.name);
                });
            }
            break; // first matching HorizontalPodAutoscaler wins
        }
    });
    return overrides;
}

/** The workload a HorizontalPodAutoscaler scales (from spec.scaleTargetRef). */
export function getHpaTarget(
    resource: K8sResource
): { kind: 'Deployment' | 'ReplicaSet'; name: string } | undefined {
    const spec = resource.spec as
        | { scaleTargetRef?: { kind?: string; name?: string } }
        | undefined;
    const ref = spec?.scaleTargetRef;
    if (
        !ref ||
        !ref.name ||
        (ref.kind !== 'Deployment' && ref.kind !== 'ReplicaSet')
    ) {
        return undefined;
    }
    return { kind: ref.kind, name: ref.name };
}

/** The resource a VerticalPodAutoscaler right-sizes (from spec.targetRef). A VPA
 *  points at the pod controller (Deployment/ReplicaSet/Job/CronJob)
 *  or at a standalone Pod, never at Pods nested inside a controller. */
export function getVpaTarget(
    resource: K8sResource
):
    | { kind: 'Deployment' | 'ReplicaSet' | 'Pod' | 'Job' | 'CronJob'; name: string }
    | undefined {
    const spec = resource.spec as
        | { targetRef?: { kind?: string; name?: string } }
        | undefined;
    const ref = spec?.targetRef;
    if (
        !ref ||
        !ref.name ||
        (ref.kind !== 'Deployment' &&
            ref.kind !== 'ReplicaSet' &&
            ref.kind !== 'Pod' &&
            ref.kind !== 'Job' &&
            ref.kind !== 'CronJob')
    ) {
        return undefined;
    }
    return { kind: ref.kind, name: ref.name };
}

/** All VPAs whose spec.targetRef points at the given kind+name (for the
 *  target's "Vertical scaled by" inspector projection). */
export function getResourcesTargetedByVpa(
    resources: K8sResource[],
    kind: 'Deployment' | 'ReplicaSet' | 'Pod' | 'Job' | 'CronJob',
    name: string
): K8sResource[] {
    return resources.filter(
        (r) =>
            r.kind === 'VerticalPodAutoscaler' &&
            getVpaTarget(r)?.kind === kind &&
            getVpaTarget(r)?.name === name
    );
}
