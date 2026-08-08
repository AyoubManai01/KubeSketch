import { describe, it, expect } from 'vitest';
import { buildGraph, cronParallelismOf, nodeIdFor } from '../buildGraph';
import type { K8sResource } from '../../types/types';

function cronJob(
    name: string,
    schedule?: string,
    parallelism?: number,
    completions?: number
): K8sResource {
    return {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name, namespace: 'default', labels: { app: name } },
        spec: {
            ...(schedule !== undefined ? { schedule } : {}),
            jobTemplate: {
                spec: {
                    ...(parallelism !== undefined ? { parallelism } : {}),
                    ...(completions !== undefined ? { completions } : {}),
                    selector: { matchLabels: { app: name } },
                    template: {
                        metadata: { labels: { app: name } },
                        spec: {
                            restartPolicy: 'OnFailure',
                            containers: [{ name: 'app', image: 'busybox:latest' }],
                        },
                    },
                },
            },
        },
    };
}

describe('CronJob materialization', () => {
    it('cronParallelismOf reads the jobTemplate parallelism and defaults to 1', () => {
        expect(cronParallelismOf(cronJob('a'))).toBe(1);
        expect(cronParallelismOf(cronJob('b', '* * * * *', 3))).toBe(3);
        expect(cronParallelismOf(cronJob('c', '* * * * *', 0))).toBe(1);
    });

    it('synthesizes exactly one Job per CronJob, flagged as managed by it', () => {
        const { nodes } = buildGraph([cronJob('cleanup', '* * * * *', 2)], []);
        const cron = nodes.find((n) => n.data.kind === 'CronJob');
        const jobs = nodes.filter((n) => n.data.kind === 'Job');
        expect(cron).toBeDefined();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].data.synthetic).toBe(true);
        expect(jobs[0].data.managedBy).toEqual({ kind: 'CronJob', name: 'cleanup' });
        expect(jobs[0].parentId).toBeUndefined();
        expect(jobs[0].draggable).toBe(true);
    });

    it('materializes the Job template parallelism as synthetic sibling Pods', () => {
        const { nodes, edges } = buildGraph([cronJob('backup', '* * * * *', 3, 5)], []);
        const cron = nodes.find((n) => n.data.kind === 'CronJob');
        const job = nodes.find((n) => n.data.kind === 'Job');
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(3);
        pods.forEach((pod) => {
            expect(pod.data.synthetic).toBe(true);
            expect(pod.data.managedBy).toEqual({ kind: 'CronJob', name: 'backup' });
            expect(pod.parentId).toBeUndefined();
            expect(pod.draggable).toBe(true);
        });
        // The Job's pods are cloned from the jobTemplate (busybox image).
        pods.forEach((pod) => {
            const containers = (pod.data.resource.spec as { containers?: any[] }).containers;
            expect(containers?.[0]?.image).toBe('busybox:latest');
        });
        // CronJob → Job "triggers", Job → each Pod "owns".
        expect(
            edges.some((e) => e.source === cron!.id && e.target === job!.id && e.label === 'triggers')
        ).toBe(true);
        const ownsEdges = edges.filter(
            (e) => e.source === job!.id && (e.label as string) === 'owns'
        );
        expect(ownsEdges).toHaveLength(3);
    });

    it('never claims an existing real Job — it creates its own', () => {
        const real: K8sResource = {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: { name: 'backup-12345', namespace: 'default', labels: { app: 'backup' } },
            spec: {
                parallelism: 1,
                selector: { matchLabels: { app: 'backup' } },
                template: {
                    metadata: { labels: { app: 'backup' } },
                    spec: {
                        restartPolicy: 'Never',
                        containers: [{ name: 'app', image: 'busybox:latest' }],
                    },
                },
            },
        };
        const { nodes } = buildGraph([cronJob('backup', '* * * * *', 2), real], []);
        const jobs = nodes.filter((n) => n.data.kind === 'Job');
        expect(jobs).toHaveLength(2);
        const realNode = jobs.find((n) => n.data.name === 'backup-12345');
        const syntheticNode = jobs.find((n) => n.data.name !== 'backup-12345');
        expect(realNode?.data.synthetic).toBeUndefined();
        expect(syntheticNode?.data.synthetic).toBe(true);
    });

    it('never claims explicit Pods from the manifest', () => {
        const pod: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'backup-0', namespace: 'default', labels: { app: 'backup' } },
            spec: { containers: [{ name: 'c', image: 'img' }] },
        };
        const { nodes } = buildGraph([cronJob('backup', '* * * * *', 2), pod], []);
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(3);
        const explicit = pods.find((n) => n.data.name === 'backup-0');
        expect(explicit?.data.synthetic).toBeUndefined();
        const materialized = pods.filter(
            (n) => n.data.name.startsWith('backup-') && n.data.synthetic
        );
        expect(materialized).toHaveLength(2);
    });

    it('respects a pinned position for the synthetic Job and its Pods on rebuild', () => {
        const first = buildGraph([cronJob('backup', '* * * * *', 2)], []);
        const job = first.nodes.find((n) => n.data.kind === 'Job')!;
        const pod = first.nodes.find((n) => n.data.kind === 'Pod')!;
        // Simulate a user drag: pin new positions on the previous render's nodes.
        const dragged = first.nodes.map((n) =>
            n.id === job.id
                ? { ...n, position: { x: 999, y: 999 } }
                : n.id === pod.id
                ? { ...n, position: { x: 1300, y: 999 } }
                : n
        );
        const { nodes } = buildGraph([cronJob('backup', '* * * * *', 2)], dragged);
        const rebuiltJob = nodes.find((n) => n.data.kind === 'Job')!;
        const rebuiltPod = nodes.find((n) => n.data.kind === 'Pod')!;
        expect(rebuiltJob.position).toEqual({ x: 999, y: 999 });
        expect(rebuiltPod.position).toEqual({ x: 1300, y: 999 });
    });

    it('nodeIdFor produces stable CronJob ids', () => {
        expect(nodeIdFor('CronJob', 'cleanup')).toBe('CronJob-cleanup');
    });
});
