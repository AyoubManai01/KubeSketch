import type { K8sResource } from '../../types/types';
import {
    CRONJOB_WIDTH,
    CRONJOB_HEIGHT,
    DEP_HEADER_HEIGHT,
    DEP_PADDING,
    JOB_WIDTH,
    JOB_HEIGHT,
    POD_WIDTH,
    POD_HEIGHT,
    POD_GAP,
    RS_GAP,
    RS_HEADER_HEIGHT,
    RS_PADDING,
    WORKLOAD_GAP,
} from './graphTypes';
import { getSavedPosition, type BuildGraphContext } from './graphContext';

/**
 * 1. LAY OUT WORKLOADS (Deployments, Standalone RS, Standalone Pods)
 *
 * Workload auto-placement must clear user-positioned workloads, otherwise every
 * new node lands at the cursor origin and stacks on top of the pinned ones
 * (which also buries their connection handles).
 */
export function layoutWorkloads(ctx: BuildGraphContext): void {
    let workloadXCursor = 50;

    const emitPod = (
        pod: K8sResource,
        parentId: string,
        parentAbs: { x: number; y: number },
        podIdx: number
    ) => {
        const podId = ctx.allocateId(pod);
        const colIdx = podIdx % 3;
        const rowIdx = Math.floor(podIdx / 3);

        const podRelPos = {
            x: RS_PADDING.left + colIdx * (POD_WIDTH + POD_GAP),
            y: RS_HEADER_HEIGHT + RS_PADDING.top + rowIdx * (POD_HEIGHT + POD_GAP),
        };
        ctx.absCoords.set(podId, { x: parentAbs.x + podRelPos.x, y: parentAbs.y + podRelPos.y });

        ctx.nodes.push({
            id: podId,
            parentId,
            extent: 'parent',
            type: 'k8sNode',
            position: podRelPos,
            style: { width: POD_WIDTH, height: POD_HEIGHT },
            data: {
                kind: 'Pod',
                name: pod.metadata.name,
                namespace: pod.metadata.namespace,
                resource: pod,
                ...ctx.syntheticMeta(pod),
            },
            draggable: false,
        });
    };

    /** Size of a container card that nests a grid of `podCount` pods (ReplicaSets):
     *  a 3-column pod grid plus the container's header/padding. */
    const podGridSize = (podCount: number) => {
        let width = 180;
        let height = 90;
        if (podCount > 0) {
            const cols = Math.min(podCount, 3);
            const rows = Math.ceil(podCount / 3);
            width = RS_PADDING.left + RS_PADDING.right + cols * POD_WIDTH + (cols - 1) * POD_GAP;
            height = RS_HEADER_HEIGHT + RS_PADDING.top + RS_PADDING.bottom + rows * POD_HEIGHT + (rows - 1) * POD_GAP;
        }
        return { width, height };
    };

    const rsSize = (rs: K8sResource) => podGridSize((ctx.rsToPod.get(rs) ?? []).length);

    const depWidthOf = (dep: K8sResource) => {
        const childRs = ctx.depToRs.get(dep) ?? [];
        if (!childRs.length) return 220;
        let w = DEP_PADDING.left;
        childRs.forEach((rs) => {
            w += rsSize(rs).width + RS_GAP;
        });
        return w - RS_GAP + DEP_PADDING.right;
    };

    const fixedWorkloadSpans: Array<{ x: number; width: number }> = [];
    const workloadPos = (kind: string, name: string) =>
        ctx.prevCoords.get(`${kind}:${name}`) || getSavedPosition(kind, name);
    ctx.deployments.forEach((dep) => {
        const pos = workloadPos('Deployment', dep.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: depWidthOf(dep) });
    });
    ctx.standaloneRs.forEach((rs) => {
        const pos = workloadPos('ReplicaSet', rs.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: rsSize(rs).width });
    });
    ctx.standalonePods.forEach((pod) => {
        const pos = workloadPos('Pod', pod.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: POD_WIDTH });
    });
    ctx.jobs.forEach((job) => {
        const pos = workloadPos('Job', job.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: JOB_WIDTH });
    });
    ctx.cronJobs.forEach((cron) => {
        const pos = workloadPos('CronJob', cron.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: CRONJOB_WIDTH });
    });
    // A pinned synthetic CronJob Job is a top-level workload too: auto-placed
    // nodes must clear it just like a real Job's pinned position.
    ctx.syntheticCronJobs.forEach((job) => {
        const pos = workloadPos('Job', job.metadata.name);
        if (pos) fixedWorkloadSpans.push({ x: pos.x, width: JOB_WIDTH });
    });

    const autoPlaceWorkload = (width: number): number => {
        let x = workloadXCursor;
        let moved = true;
        while (moved) {
            moved = false;
            for (const span of fixedWorkloadSpans) {
                if (x < span.x + span.width + WORKLOAD_GAP && x + width + WORKLOAD_GAP > span.x) {
                    x = span.x + span.width + WORKLOAD_GAP;
                    moved = true;
                }
            }
        }
        workloadXCursor = x + width + WORKLOAD_GAP;
        return x;
    };

    // A. Deployments
    ctx.deployments.forEach((dep) => {
        const childRs = ctx.depToRs.get(dep) ?? [];

        // First layout nested components to determine Deployment size
        const rsDimensions: Array<{ width: number; height: number; x: number; y: number; node: K8sResource }> = [];
        let currentRsX = DEP_PADDING.left;
        let maxRsHeight = 80;

        childRs.forEach((rs) => {
            const { width: rsWidth, height: rsHeight } = rsSize(rs);
            rsDimensions.push({
                width: rsWidth,
                height: rsHeight,
                x: currentRsX,
                y: DEP_HEADER_HEIGHT + DEP_PADDING.top,
                node: rs,
            });
            currentRsX += rsWidth + RS_GAP;
            if (rsHeight > maxRsHeight) maxRsHeight = rsHeight;
        });

        // Compute Deployment dimensions
        const depWidth = childRs.length > 0
            ? currentRsX - RS_GAP + DEP_PADDING.right
            : 220;
        const depHeight = childRs.length > 0
            ? DEP_HEADER_HEIGHT + DEP_PADDING.top + DEP_PADDING.bottom + maxRsHeight
            : 100;

        // Position Deployment
        const depId = ctx.allocateId(dep);
        const key = `Deployment:${dep.metadata.name}`;
        const savedPos = getSavedPosition('Deployment', dep.metadata.name);
        const prevPos = ctx.prevCoords.get(key);
        const depPos = prevPos || savedPos || { x: autoPlaceWorkload(depWidth), y: 320 };

        ctx.absCoords.set(depId, depPos);

        ctx.nodes.push({
            id: depId,
            type: 'k8sNode',
            position: depPos,
            style: { width: depWidth, height: depHeight },
            data: {
                kind: 'Deployment',
                name: dep.metadata.name,
                namespace: dep.metadata.namespace,
                resource: dep,
            },
            draggable: true,
        });

        // Add child ReplicaSets and Pods
        rsDimensions.forEach((rsDim) => {
            const rsId = ctx.allocateId(rsDim.node);
            const rsRelPos = { x: rsDim.x, y: rsDim.y };
            const rsAbsPos = { x: depPos.x + rsRelPos.x, y: depPos.y + rsRelPos.y };
            ctx.absCoords.set(rsId, rsAbsPos);

            ctx.nodes.push({
                id: rsId,
                parentId: depId,
                extent: 'parent',
                type: 'k8sNode',
                position: rsRelPos,
                style: { width: rsDim.width, height: rsDim.height },
                data: {
                    kind: 'ReplicaSet',
                    name: rsDim.node.metadata.name,
                    namespace: rsDim.node.metadata.namespace,
                    resource: rsDim.node,
                    ...ctx.syntheticMeta(rsDim.node),
                },
                draggable: false,
            });

            (ctx.rsToPod.get(rsDim.node) ?? []).forEach((pod, podIdx) => emitPod(pod, rsId, rsAbsPos, podIdx));
        });
    });

    // B. Standalone ReplicaSets
    ctx.standaloneRs.forEach((rs) => {
        const rsId = ctx.allocateId(rs);
        const { width: rsWidth, height: rsHeight } = rsSize(rs);

        const key = `ReplicaSet:${rs.metadata.name}`;
        const savedPos = getSavedPosition('ReplicaSet', rs.metadata.name);
        const prevPos = ctx.prevCoords.get(key);
        const rsPos = prevPos || savedPos || { x: autoPlaceWorkload(rsWidth), y: 320 };

        ctx.absCoords.set(rsId, rsPos);

        ctx.nodes.push({
            id: rsId,
            type: 'k8sNode',
            position: rsPos,
            style: { width: rsWidth, height: rsHeight },
            data: {
                kind: 'ReplicaSet',
                name: rs.metadata.name,
                namespace: rs.metadata.namespace,
                resource: rs,
            },
            draggable: true,
        });

        (ctx.rsToPod.get(rs) ?? []).forEach((pod, podIdx) => emitPod(pod, rsId, rsPos, podIdx));
    });

    // C. Standalone Pods
    ctx.standalonePods.forEach((pod) => {
        const podId = ctx.allocateId(pod);
        const key = `Pod:${pod.metadata.name}`;
        const savedPos = getSavedPosition('Pod', pod.metadata.name);
        const prevPos = ctx.prevCoords.get(key);
        const podPos = prevPos || savedPos || { x: autoPlaceWorkload(POD_WIDTH), y: 320 };

        ctx.absCoords.set(podId, podPos);

        ctx.nodes.push({
            id: podId,
            type: 'k8sNode',
            position: podPos,
            style: { width: POD_WIDTH, height: POD_HEIGHT },
            data: {
                kind: 'Pod',
                name: pod.metadata.name,
                namespace: pod.metadata.namespace,
                resource: pod,
            },
            draggable: true,
        });
    });

    // D. Jobs: the Job node plus the Pods it runs (siblings, linked by an inferred edge)
    ctx.jobs.forEach((job) => {
        const jobId = ctx.allocateId(job);
        const key = `Job:${job.metadata.name}`;
        const savedPos = getSavedPosition('Job', job.metadata.name);
        const prevPos = ctx.prevCoords.get(key);
        const jobPos = prevPos || savedPos || { x: autoPlaceWorkload(JOB_WIDTH), y: 320 };

        ctx.absCoords.set(jobId, jobPos);

        ctx.nodes.push({
            id: jobId,
            type: 'k8sNode',
            position: jobPos,
            style: { width: JOB_WIDTH, height: JOB_HEIGHT },
            data: {
                kind: 'Job',
                name: job.metadata.name,
                namespace: job.metadata.namespace,
                resource: job,
            },
            draggable: true,
        });

        const children = ctx.jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = ctx.allocateId(pod);
            const savedPodPos = getSavedPosition('Pod', pod.metadata.name);
            const prevPodPos = ctx.prevCoords.get(`Pod:${pod.metadata.name}`);
            const podPos = prevPodPos || savedPodPos || {
                x: autoPlaceWorkload(POD_WIDTH),
                y: 320,
            };
            ctx.absCoords.set(podId, podPos);
            ctx.nodes.push({
                id: podId,
                type: 'k8sNode',
                position: podPos,
                style: { width: POD_WIDTH, height: POD_HEIGHT },
                data: {
                    kind: 'Pod',
                    name: pod.metadata.name,
                    namespace: pod.metadata.namespace,
                    resource: pod,
                    ...ctx.syntheticMeta(pod),
                },
                draggable: true,
            });
        });
    });

    // E. CronJobs: the CronJob node plus the Job it creates and that Job's Pods
    // (all siblings, linked by inferred edges). The synthetic Job and its Pods
    // are draggable like a real Job's Pods (positions persist), and are
    // auto-placed right after their CronJob so the group reads left-to-right:
    // CronJob → Job → Pods.
    ctx.cronJobs.forEach((cron) => {
        const cronId = ctx.allocateId(cron);
        const key = `CronJob:${cron.metadata.name}`;
        const savedPos = getSavedPosition('CronJob', cron.metadata.name);
        const prevPos = ctx.prevCoords.get(key);
        const cronPos = prevPos || savedPos || { x: autoPlaceWorkload(CRONJOB_WIDTH), y: 320 };

        ctx.absCoords.set(cronId, cronPos);

        ctx.nodes.push({
            id: cronId,
            type: 'k8sNode',
            position: cronPos,
            style: { width: CRONJOB_WIDTH, height: CRONJOB_HEIGHT },
            data: {
                kind: 'CronJob',
                name: cron.metadata.name,
                namespace: cron.metadata.namespace,
                resource: cron,
            },
            draggable: true,
        });

        const job = ctx.cronToJob.get(cron);
        if (!job) return;
        const jobId = ctx.allocateId(job);
        const savedJobPos = getSavedPosition('Job', job.metadata.name);
        const prevJobPos = ctx.prevCoords.get(`Job:${job.metadata.name}`);
        const jobPos = prevJobPos || savedJobPos || { x: autoPlaceWorkload(JOB_WIDTH), y: 320 };
        ctx.absCoords.set(jobId, jobPos);
        ctx.nodes.push({
            id: jobId,
            type: 'k8sNode',
            position: jobPos,
            style: { width: JOB_WIDTH, height: JOB_HEIGHT },
            data: {
                kind: 'Job',
                name: job.metadata.name,
                namespace: job.metadata.namespace,
                resource: job,
                ...ctx.syntheticMeta(job),
            },
            draggable: true,
        });

        const children = ctx.jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = ctx.allocateId(pod);
            const savedPodPos = getSavedPosition('Pod', pod.metadata.name);
            const prevPodPos = ctx.prevCoords.get(`Pod:${pod.metadata.name}`);
            const podPos = prevPodPos || savedPodPos || {
                x: autoPlaceWorkload(POD_WIDTH),
                y: 320,
            };
            ctx.absCoords.set(podId, podPos);
            ctx.nodes.push({
                id: podId,
                type: 'k8sNode',
                position: podPos,
                style: { width: POD_WIDTH, height: POD_HEIGHT },
                data: {
                    kind: 'Pod',
                    name: pod.metadata.name,
                    namespace: pod.metadata.namespace,
                    resource: pod,
                    ...ctx.syntheticMeta(pod),
                },
                draggable: true,
            });
        });
    });
}
