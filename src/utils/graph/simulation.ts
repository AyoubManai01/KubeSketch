import type { K8sResource } from '../../types/types';
import { MAX_SYNTHETIC_PODS } from './graphTypes';
import { getWorkloadPodLabels, ownsResource, parallelismOf, replicasOf, shortHash } from './selectors';
import type { BuildGraphContext } from './graphContext';

/** The ReplicaSet a real cluster would create for a Deployment. */
function synthesizeReplicaSet(dep: K8sResource, replicas?: number): K8sResource {
    const spec = dep.spec as { template?: unknown } | undefined;
    const podLabels = getWorkloadPodLabels(dep) ?? { app: dep.metadata.name };
    return {
        apiVersion: 'apps/v1',
        kind: 'ReplicaSet',
        metadata: {
            name: `${dep.metadata.name}-${shortHash(dep.metadata.name)}`,
            ...(dep.metadata.namespace ? { namespace: dep.metadata.namespace } : {}),
            labels: { ...podLabels },
        },
        spec: {
            replicas: replicas ?? replicasOf(dep),
            selector: { matchLabels: { ...podLabels } },
            ...(spec?.template ? { template: structuredClone(spec.template) } : {}),
        },
    };
}

/** One of the Pods a real cluster would run for a ReplicaSet. */
function synthesizePod(rs: K8sResource, name: string): K8sResource {
    const spec = rs.spec as { template?: { spec?: unknown } } | undefined;
    const labels = getWorkloadPodLabels(rs) ?? { app: rs.metadata.name };
    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name,
            ...(rs.metadata.namespace ? { namespace: rs.metadata.namespace } : {}),
            labels: { ...labels },
        },
        spec: spec?.template?.spec ? structuredClone(spec.template.spec) : {},
    };
}

/**
 * The Job a real cluster's CronJob controller would create for its next scheduled
 * run. The Job's spec is the CronJob's `spec.jobTemplate.spec`. A CronJob never
 * links to an existing Job, it always creates its own.
 */
function synthesizeJob(cron: K8sResource): K8sResource {
    const spec = cron.spec as { jobTemplate?: { spec?: unknown } } | undefined;
    const podLabels = getWorkloadPodLabels(cron) ?? { app: cron.metadata.name };
    return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: {
            name: `${cron.metadata.name}-${shortHash(cron.metadata.name)}`,
            ...(cron.metadata.namespace ? { namespace: cron.metadata.namespace } : {}),
            labels: { ...podLabels },
        },
        spec: spec?.jobTemplate?.spec
            ? structuredClone(spec.jobTemplate.spec)
            : {
                  template: {
                      metadata: { labels: { ...podLabels } },
                      spec: { restartPolicy: 'OnFailure', containers: [{ name: 'app', image: 'nginx:latest' }] },
                  },
              },
    };
}

/**
 * Ownership assignment: each ReplicaSet is claimed by at most ONE Deployment,
 * each Pod by at most ONE ReplicaSet (first match wins). This prevents a resource
 * from being rendered multiple times under different parents.
 */
export function assignOwnership(ctx: BuildGraphContext): void {
    ctx.deployments.forEach((dep) => {
        const children = ctx.replicaSets.filter((rs) => {
            if (ctx.claimedRs.has(rs)) return false;
            return ownsResource(dep, rs);
        });
        children.forEach((rs) => ctx.claimedRs.add(rs));
        ctx.depToRs.set(dep, children);
    });
}

/**
 * ── Controller simulation: materialize what Kubernetes would create ─────
 * A Deployment with no matching ReplicaSet gets a synthetic one, every
 * ReplicaSet materializes its pod shortfall, Jobs claim/materialize their Pods,
 * and every CronJob creates exactly one synthetic Job with its own Pods.
 * Synthetic resources never claim existing ones (real Jobs stay standalone).
 */
export function materializeSynthetics(ctx: BuildGraphContext): void {
    ctx.deployments.forEach((dep) => {
        const children = ctx.depToRs.get(dep)!;
        if (children.length === 0) {
            const rs = synthesizeReplicaSet(dep, ctx.effectiveReplicasOf(dep));
            ctx.syntheticOwner.set(rs, { kind: 'Deployment', name: dep.metadata.name });
            children.push(rs);
        }
    });
    ctx.syntheticRs.push(...ctx.syntheticOwner.keys());

    // Real ReplicaSets claim explicit Pods first, then synthetic ones get a chance
    const allReplicaSets = [...ctx.replicaSets, ...ctx.syntheticRs];
    allReplicaSets.forEach((rs) => {
        const children = ctx.pods.filter((pod) => {
            if (ctx.claimedPods.has(pod)) return false;
            return ownsResource(rs, pod);
        });
        children.forEach((pod) => ctx.claimedPods.add(pod));
        ctx.rsToPod.set(rs, children);
    });

    // Materialize the pod shortfall for every ReplicaSet: replicas minus explicit pods
    const usedPodNames = new Set(ctx.pods.map((p) => p.metadata.name));
    const syntheticPods: K8sResource[] = [];
    allReplicaSets.forEach((rs) => {
        const explicit = ctx.rsToPod.get(rs) ?? [];
        const desired = ctx.desiredReplicasFor(rs);
        const shortfall = Math.min(Math.max(desired - explicit.length, 0), MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;

        const owner = ctx.syntheticOwner.get(rs) ?? { kind: rs.kind, name: rs.metadata.name };
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${rs.metadata.name}-${suffix++}`;
            while (usedPodNames.has(name)) name = `${rs.metadata.name}-${suffix++}`;
            usedPodNames.add(name);
            const pod = synthesizePod(rs, name);
            ctx.syntheticOwner.set(pod, owner);
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        ctx.rsToPod.set(rs, [...explicit, ...generated]);
    });

    // Jobs own their Pods directly (no ReplicaSet layer): claim explicit Pods that
    // match the Job's selector/name, then materialize the shortfall up to
    // spec.parallelism. Job Pods are siblings of the Job node (linked by an inferred
    // edge), never nested: Kubernetes never re-parents them.
    ctx.jobs.forEach((job) => {
        const children = ctx.pods.filter((pod) => {
            if (ctx.claimedJobPods.has(pod)) return false;
            return ownsResource(job, pod);
        });
        children.forEach((pod) => ctx.claimedJobPods.add(pod));
        ctx.jobToPod.set(job, children);
    });
    const usedJobPodNames = new Set(ctx.pods.map((p) => p.metadata.name));
    ctx.jobs.forEach((job) => {
        const explicit = ctx.jobToPod.get(job) ?? [];
        const desired = parallelismOf(job);
        const shortfall = Math.min(Math.max(desired - explicit.length, 0), MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${job.metadata.name}-${suffix++}`;
            while (usedJobPodNames.has(name)) name = `${job.metadata.name}-${suffix++}`;
            usedJobPodNames.add(name);
            const pod = synthesizePod(job, name);
            ctx.syntheticOwner.set(pod, { kind: 'Job', name: job.metadata.name });
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        ctx.jobToPod.set(job, [...explicit, ...generated]);
    });

    // CronJobs always create their OWN Job (never claim an existing one: a real
    // Job in the manifest stays standalone). Synthesize exactly one Job from the
    // CronJob's spec.jobTemplate.spec and materialize its Pods up to the
    // template's parallelism. The Job and its Pods are siblings of the CronJob
    // node (linked by inferred edges), never nested.
    ctx.cronJobs.forEach((cron) => {
        const job = synthesizeJob(cron);
        ctx.syntheticOwner.set(job, { kind: 'CronJob', name: cron.metadata.name });
        ctx.cronToJob.set(cron, job);
        ctx.syntheticCronJobs.push(job);
    });
    ctx.syntheticCronJobs.forEach((job) => {
        const desired = parallelismOf(job);
        const shortfall = Math.min(desired, MAX_SYNTHETIC_PODS);
        if (shortfall === 0) return;
        const owner = ctx.syntheticOwner.get(job) ?? { kind: 'CronJob', name: job.metadata.name };
        const generated: K8sResource[] = [];
        let suffix = 1;
        for (let i = 0; i < shortfall; i++) {
            let name = `${job.metadata.name}-${suffix++}`;
            while (usedJobPodNames.has(name)) name = `${job.metadata.name}-${suffix++}`;
            usedJobPodNames.add(name);
            const pod = synthesizePod(job, name);
            ctx.syntheticOwner.set(pod, owner);
            generated.push(pod);
        }
        syntheticPods.push(...generated);
        ctx.jobToPod.set(job, generated);
    });

    // All pods (explicit + synthetic)
    ctx.allPods.push(...ctx.pods, ...syntheticPods);

    // Standalone elements
    ctx.standaloneRs.push(...ctx.replicaSets.filter((rs) => !ctx.claimedRs.has(rs)));
    ctx.standalonePods.push(
        ...ctx.pods.filter((pod) => !ctx.claimedPods.has(pod) && !ctx.claimedJobPods.has(pod))
    );
}
