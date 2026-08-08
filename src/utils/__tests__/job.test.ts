import { describe, it, expect } from 'vitest';
import { buildGraph, parallelismOf, nodeIdFor } from '../buildGraph';
import type { K8sResource } from '../../types/types';

function job(name: string, parallelism?: number, completions?: number): K8sResource {
    return {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name, namespace: 'default', labels: { app: name } },
        spec: {
            ...(parallelism !== undefined ? { parallelism } : {}),
            ...(completions !== undefined ? { completions } : {}),
            selector: { matchLabels: { app: name } },
            template: {
                metadata: { labels: { app: name } },
                spec: { restartPolicy: 'Never', containers: [{ name: 'app', image: 'nginx:latest' }] },
            },
        },
    };
}

describe('Job materialization', () => {
    it('parallelismOf defaults to 1', () => {
        expect(parallelismOf(job('a'))).toBe(1);
        expect(parallelismOf(job('b', 3))).toBe(3);
        expect(parallelismOf(job('c', 0))).toBe(1);
    });

    it('materializes parallelism Pods as synthetic siblings with owns edges', () => {
        const { nodes, edges } = buildGraph([job('pi', 3, 5)], []);
        const jobNode = nodes.find((n) => n.data.kind === 'Job');
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(jobNode).toBeDefined();
        expect(pods).toHaveLength(3);
        pods.forEach((pod) => {
            expect(pod.data.synthetic).toBe(true);
            expect(pod.data.managedBy).toEqual({ kind: 'Job', name: 'pi' });
            expect(pod.parentId).toBeUndefined();
        });
        const ownsEdges = edges.filter(
            (e) => e.source === jobNode!.id && (e.label as string) === 'owns'
        );
        expect(ownsEdges).toHaveLength(3);
    });

    it('adopts an explicit Pod that matches the Job selector', () => {
        const pod: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'pi-0', namespace: 'default', labels: { app: 'pi' } },
            spec: { containers: [{ name: 'c', image: 'img' }] },
        };
        const { nodes } = buildGraph([job('pi', 2), pod], []);
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(2);
        const explicit = pods.find((n) => n.data.name === 'pi-0');
        expect(explicit?.data.synthetic).toBeUndefined();
        const materialized = pods.find((n) => n.data.name === 'pi-1');
        expect(materialized?.data.synthetic).toBe(true);
    });

    it('Job pods never nest inside a Deployment or ReplicaSet', () => {
        const deployment: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'Deployment',
            metadata: { name: 'web' },
            spec: {
                replicas: 2,
                selector: { matchLabels: { app: 'web' } },
                template: { metadata: { labels: { app: 'web' } }, spec: {} },
            },
        };
        const { nodes } = buildGraph([deployment, job('pi', 2)], []);
        const jobNode = nodes.find((n) => n.data.kind === 'Job');
        const jobPods = nodes.filter(
            (n) => n.data.kind === 'Pod' && n.data.managedBy?.kind === 'Job'
        );
        jobPods.forEach((pod) => {
            expect(pod.parentId).toBeUndefined();
            expect(pod.parentId).not.toBe(jobNode!.id);
        });
    });

    it('nodeIdFor produces stable Job ids', () => {
        expect(nodeIdFor('Job', 'pi')).toBe('Job-pi');
    });
});
