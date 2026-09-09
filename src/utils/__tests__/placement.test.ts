import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { repairPlacements, placeNewNamespaceRect, placeNewNodeRect } from '../placement';
import { buildGraph, type K8sNodeData } from '../buildGraph';
import type { NsLayout } from '../teachingFrame';
import type { K8sResource, SupportedKind } from '../../types/types';

function node(
    kind: SupportedKind,
    name: string,
    x: number,
    y: number,
    width = 180,
    height = 104,
    namespace = 'default'
): Node<K8sNodeData> {
    return {
        id: `${kind}-${name}`,
        type: 'k8sNode',
        position: { x, y },
        style: { width, height },
        data: {
            kind,
            name,
            namespace,
            resource: {
                apiVersion: 'v1',
                kind,
                metadata: { name, namespace },
            } as K8sResource,
        },
        draggable: true,
    };
}

describe('placeNewNamespaceRect', () => {
    it('places a new namespace rect inside the cluster at the preferred spot', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'a', x: 100, y: 100, width: 300, height: 200 }],
        };
        const { rect, cluster } = placeNewNamespaceRect(layout, 320, 240, { x: 40, y: 40 });
        expect(rect.x + 320).toBeLessThanOrEqual(1200);
        expect(rect.y + 240).toBeLessThanOrEqual(900);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(cluster).toEqual(layout.cluster); // no growth needed
    });

    it('sweeps into a free pocket avoiding existing namespace rects', () => {
        // The preferred spot overlaps ns 'a'; the pocket to its right is free.
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'a', x: 100, y: 100, width: 700, height: 700 }],
        };
        const { rect, cluster } = placeNewNamespaceRect(layout, 320, 240, { x: 150, y: 150 });
        const a = layout.namespaces[0];
        const overlaps =
            rect.x < a.x + a.width &&
            rect.x + 320 > a.x &&
            rect.y < a.y + a.height &&
            rect.y + 240 > a.y;
        expect(overlaps).toBe(false);
        expect(rect.x + 320).toBeLessThanOrEqual(1200);
        expect(rect.y + 240).toBeLessThanOrEqual(900);
        expect(cluster).toEqual(layout.cluster);
    });

    it('grows the cluster when there is no free space inside', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 400, height: 300 },
            nodes: [],
            namespaces: [{ name: 'a', x: 10, y: 10, width: 380, height: 280 }],
        };
        const { rect, cluster } = placeNewNamespaceRect(layout, 320, 240, { x: 20, y: 20 });
        // The rect is still fully inside the (grown) cluster.
        expect(rect.x).toBeGreaterThanOrEqual(cluster.x);
        expect(rect.y).toBeGreaterThanOrEqual(cluster.y);
        expect(rect.x + 320).toBeLessThanOrEqual(cluster.x + cluster.width);
        expect(rect.y + 240).toBeLessThanOrEqual(cluster.y + cluster.height);
        expect(cluster.height).toBeGreaterThan(300); // grew to fit the appended rect
        expect(cluster.width).toBeGreaterThanOrEqual(400); // grow-only
    });
});

describe('repairPlacements', () => {
    it('keeps an already valid auto-placed node untouched (idempotent)', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        const nodes = [node('ConfigMap', 'cm', 150, 150)];
        const result = repairPlacements(nodes, new Set(['ConfigMap-cm']), layout);
        expect(result.nodes[0]).toBe(nodes[0]); // same object — never moved
        expect(result.layoutChanged).toBe(false);
    });

    it('pulls an auto-placed node that landed outside its namespace box back inside', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        // Lane position (x=50, y=320) is outside the box (box starts at x=100).
        const nodes = [node('Deployment', 'web', 50, 320, 220, 150)];
        const result = repairPlacements(nodes, new Set(['Deployment-web']), layout);
        const pos = result.nodes[0].position;
        expect(pos.x).toBeGreaterThanOrEqual(100);
        expect(pos.y).toBeGreaterThanOrEqual(100);
        expect(pos.x + 220).toBeLessThanOrEqual(600);
        expect(pos.y + 150).toBeLessThanOrEqual(600);
        expect(result.layoutChanged).toBe(false);
    });

    it('moves an auto-placed node off a pinned resource inside the box', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 700, height: 700 }],
        };
        // Pinned ConfigMap at (100, 175); auto Deployment lands on top of it.
        const pinned = node('ConfigMap', 'pinned', 100, 175);
        const dep = node('Deployment', 'web', 100, 175, 220, 150);
        const result = repairPlacements([pinned, dep], new Set(['Deployment-web']), layout);
        const pos = result.nodes[1].position;
        expect(pos.x).not.toBe(100);
        expect(pos.x).toBeGreaterThanOrEqual(280); // pushed right of the pinned node + gap
        expect(pos.y + 150).toBeLessThanOrEqual(800);
        expect(result.nodes[0].position).toEqual({ x: 100, y: 175 }); // pinned untouched
    });

    it('grows a box too small for the new resource so it fits inside', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 120, height: 90 }],
        };
        const nodes = [node('ConfigMap', 'cm', 50, 680)];
        const result = repairPlacements(nodes, new Set(['ConfigMap-cm']), layout);
        const pos = result.nodes[0].position;
        expect(pos.y).toBeGreaterThanOrEqual(190); // appended below the box content
        expect(result.layoutChanged).toBe(true);
        const ns = result.nsLayout!.namespaces[0];
        // The box grew to contain the node plus padding on every side.
        expect(pos.x + 180 + 12).toBeLessThanOrEqual(ns.x + ns.width);
        expect(pos.y + 104 + 12).toBeLessThanOrEqual(ns.y + ns.height);
        // And the cluster grew to cover the grown box.
        expect(ns.x + ns.width + 24).toBeLessThanOrEqual(result.nsLayout!.cluster.x + result.nsLayout!.cluster.width);
    });

    it('pushes a sibling namespace (and its resources) down when growth is blocked', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [],
            namespaces: [
                { name: 'a', x: 100, y: 100, width: 300, height: 100 },
                { name: 'b', x: 100, y: 320, width: 300, height: 200 },
                { name: 'c', x: 450, y: 100, width: 200, height: 300 },
            ],
        };
        // A huge ConfigMap-like node that cannot fit inside ns 'a' and is blocked
        // below (b) and right (c) — ns 'a' must grow and push 'b' down.
        const big = node('ConfigMap', 'cm2', 50, 680, 400, 300, 'a');
        const bNode = node('Deployment', 'be', 150, 360, 180, 104, 'b');
        const nodes = [big, bNode];
        const result = repairPlacements(nodes, new Set(['ConfigMap-cm2']), layout);
        const pos = result.nodes[0].position;
        // The node ended up below box 'a', which then grew and pushed 'b' away.
        expect(pos.y).toBeGreaterThanOrEqual(200);
        const a = result.nsLayout!.namespaces.find((ns) => ns.name === 'a')!;
        const b = result.nsLayout!.namespaces.find((ns) => ns.name === 'b')!;
        expect(a.y + a.height).toBeLessThanOrEqual(b.y); // no overlap
        expect(pos.y + 300 + 12).toBeLessThanOrEqual(a.y + a.height);
        // 'b's resource translated with its box.
        expect(result.nodes[1].position.y).toBe(b.y + 360 - 320);
    });

    it('keeps cluster-scoped resources out of namespace boxes and inside the cluster', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1300, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        // A PV placed inside the namespace box must be pushed out — it belongs
        // outside every namespace box, inside the cluster.
        const pv = node('PersistentVolume', 'pv', 120, 130, 175, 124);
        const result = repairPlacements([pv], new Set(['PersistentVolume-pv']), layout);
        const pos = result.nodes[0].position;
        const box = layout.namespaces[0];
        const inBox =
            pos.x < box.x + box.width &&
            pos.x + 175 > box.x &&
            pos.y < box.y + box.height &&
            pos.y + 124 > box.y;
        expect(inBox).toBe(false);
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x + 175).toBeLessThanOrEqual(1300);
        expect(pos.y + 124).toBeLessThanOrEqual(900);
        expect(result.layoutChanged).toBe(false);
    });

    it('de-overlaps cross-lane nodes in pure auto mode without touching nsLayout', () => {
        // A tall Deployment at the workload lane overlaps an HPA auto-aligned
        // beneath it (both auto-placed, no persisted layout). The smaller HPA
        // yields: it slides right, the Deployment keeps its lane spot.
        const dep = node('Deployment', 'web', 50, 320, 220, 300);
        const hpa = node('HorizontalPodAutoscaler', 'web', 50, 520, 175, 104);
        const result = repairPlacements([dep, hpa], new Set(['Deployment-web', 'HorizontalPodAutoscaler-web']), null);
        const depPos = result.nodes[0].position;
        const hpaPos = result.nodes[1].position;
        expect(depPos).toEqual({ x: 50, y: 320 }); // workload untouched
        expect(hpaPos.x).toBeGreaterThanOrEqual(depPos.x + 220 + 24 - 1); // pushed right of the deployment
        expect(result.layoutChanged).toBe(false);
        expect(result.nsLayout).toBeNull();
    });

    it('places a new namespace’s first resource in free cluster space, not inside another namespace', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        // Lane position lands inside ns 'default'; the node belongs to 'team-b'.
        const nodes = [node('ConfigMap', 'cm', 150, 150, 180, 104, 'team-b')];
        const result = repairPlacements(nodes, new Set(['ConfigMap-cm']), layout);
        const pos = result.nodes[0].position;
        const def = layout.namespaces[0];
        const overlapsDefault =
            pos.x < def.x + def.width && pos.x + 180 > def.x && pos.y < def.y + def.height && pos.y + 104 > def.y;
        expect(overlapsDefault).toBe(false);
    });

    it('never leaves a rect-less namespace’s resource outside the cluster', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 800, height: 600 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 400, height: 400 }],
        };
        // Route-lane position (y=1640) is far below the cluster bottom (600).
        const nodes = [node('HTTPRoute', 'r', 50, 1640, 180, 124, 'team-b')];
        const result = repairPlacements(nodes, new Set(['HTTPRoute-r']), layout);
        const pos = result.nodes[0].position;
        expect(pos.y + 124).toBeLessThanOrEqual(600); // inside the cluster
        expect(pos.x + 180).toBeLessThanOrEqual(800);
        const def = layout.namespaces[0]; // and not inside another namespace's box
        const overlapsDefault =
            pos.x < def.x + def.width &&
            pos.x + 180 > def.x &&
            pos.y < def.y + def.height &&
            pos.y + 124 > def.y;
        expect(overlapsDefault).toBe(false);
    });

    it('sweeps a rect-less namespace’s resource into the cluster even with no namespace boxes around', () => {
        // Persisted layout with NO namespace rects and a cluster that doesn't
        // cover the lane position at all — the sweep must still find a spot
        // inside the cluster (cluster-edge candidates), not below it.
        const layout: NsLayout = {
            cluster: { x: 600, y: 400, width: 800, height: 600 },
            nodes: [],
            namespaces: [],
        };
        const nodes = [node('Deployment', 'web', 50, 320, 220, 150, 'team-b')];
        const result = repairPlacements(nodes, new Set(['Deployment-web']), layout);
        const pos = result.nodes[0].position;
        expect(pos.x).toBeGreaterThanOrEqual(600);
        expect(pos.y).toBeGreaterThanOrEqual(400);
        expect(pos.x + 220).toBeLessThanOrEqual(1400);
        expect(pos.y + 150).toBeLessThanOrEqual(1000);
    });

    it('repairs synthetic CronJob siblings (Job + Pods) into the owner’s namespace', () => {
        const cron: K8sResource = {
            apiVersion: 'batch/v1',
            kind: 'CronJob',
            metadata: { name: 'backup', namespace: 'ops' },
            spec: {
                schedule: '0 3 * * *',
                jobTemplate: {
                    spec: {
                        parallelism: 2,
                        template: {
                            spec: {
                                containers: [{ name: 'job', image: 'busybox' }],
                                restartPolicy: 'Never',
                            },
                        },
                    },
                },
            },
        };
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1400 },
            nodes: [],
            namespaces: [
                { name: 'ops', x: 300, y: 300, width: 500, height: 500 },
                { name: 'default', x: 100, y: 100, width: 400, height: 400 },
            ],
        };
        const { nodes: built, autoPlacedIds } = buildGraph([cron], []);
        expect(autoPlacedIds.size).toBeGreaterThan(0); // Job + 2 Pods are auto-placed
        const result = repairPlacements(built, autoPlacedIds, layout);
        // Every top-level node of the CronJob family lands inside ns 'ops'.
        result.nodes
            .filter((n) => !n.parentId && n.data.kind !== 'CronJob')
            .forEach((n) => {
                const pos = n.position;
                expect(pos.x).toBeGreaterThanOrEqual(300);
                expect(pos.y).toBeGreaterThanOrEqual(300);
                expect(pos.x).toBeLessThanOrEqual(800);
                expect(pos.y).toBeLessThanOrEqual(800);
            });
        // And nothing overlaps: no two top-level node boxes intersect.
        const tops = result.nodes.filter((n) => !n.parentId);
        for (let i = 0; i < tops.length; i++) {
            for (let j = i + 1; j < tops.length; j++) {
                const a = tops[i];
                const b = tops[j];
                const wA = typeof a.style?.width === 'number' ? a.style.width : 180;
                const hA = typeof a.style?.height === 'number' ? a.style.height : 104;
                const wB = typeof b.style?.width === 'number' ? b.style.width : 180;
                const hB = typeof b.style?.height === 'number' ? b.style.height : 104;
                const overlap =
                    a.position.x < b.position.x + wB &&
                    a.position.x + wA > b.position.x &&
                    a.position.y < b.position.y + hB &&
                    a.position.y + hA > b.position.y;
                expect(overlap, `${a.data.kind} ${a.data.name} vs ${b.data.kind} ${b.data.name}`).toBe(false);
            }
        }
    });

    it('does not treat previously-positioned (pinned) nodes as repairable', () => {
        const prev = [node('Deployment', 'web', 500, 300, 220, 150)];
        const { autoPlacedIds } = buildGraph([prev[0].data.resource], prev);
        expect(autoPlacedIds.has('Deployment-web')).toBe(false);
    });
});

describe('placeNewNodeRect', () => {
    it('places a new node rect inside the cluster, avoiding node AND namespace rects', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [{ name: 'n1', x: 100, y: 100, width: 500, height: 400 }],
            namespaces: [{ name: 'default', x: 100, y: 520, width: 300, height: 200 }],
        };
        const { rect, cluster } = placeNewNodeRect(layout, 480, 360, { x: 40, y: 40 });
        const noOverlap = (r: { x: number; y: number; width: number; height: number }) =>
            !(
                rect.x < r.x + r.width &&
                rect.x + 480 > r.x &&
                rect.y < r.y + r.height &&
                rect.y + 360 > r.y
            );
        expect(noOverlap(layout.nodes[0])).toBe(true);
        expect(noOverlap(layout.namespaces[0])).toBe(true);
        expect(rect.x + 480).toBeLessThanOrEqual(1200);
        expect(rect.y + 360).toBeLessThanOrEqual(900);
        expect(cluster).toEqual(layout.cluster); // no growth needed
    });

    it('grows the cluster when there is no free pocket for a new node rect', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 500, height: 400 },
            nodes: [{ name: 'n1', x: 10, y: 10, width: 480, height: 380 }],
            namespaces: [],
        };
        const { rect, cluster } = placeNewNodeRect(layout, 480, 360, { x: 20, y: 20 });
        expect(rect.x).toBeGreaterThanOrEqual(cluster.x);
        expect(rect.y).toBeGreaterThanOrEqual(cluster.y);
        expect(rect.x + 480).toBeLessThanOrEqual(cluster.x + cluster.width);
        expect(rect.y + 360).toBeLessThanOrEqual(cluster.y + cluster.height);
        expect(cluster.height).toBeGreaterThan(400); // grew to fit the appended rect
        expect(cluster.width).toBeGreaterThanOrEqual(500); // grow-only
    });
});

describe('repairPlacements with physical nodes', () => {
    it('keeps cluster-scoped resources out of physical node rects too', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1300, height: 1000 },
            nodes: [{ name: 'worker-1', x: 100, y: 100, width: 500, height: 500 }],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        // A PV whose lane spot sits inside the node rect must be pushed out —
        // storage infra never sits "on" a node box.
        const pv = node('PersistentVolume', 'pv', 120, 130, 175, 124);
        const result = repairPlacements([pv], new Set(['PersistentVolume-pv']), layout);
        const pos = result.nodes[0].position;
        const nodeRect = layout.nodes[0];
        const inNode =
            pos.x < nodeRect.x + nodeRect.width &&
            pos.x + 175 > nodeRect.x &&
            pos.y < nodeRect.y + nodeRect.height &&
            pos.y + 124 > nodeRect.y;
        expect(inNode).toBe(false);
        expect(pos.x).toBeGreaterThanOrEqual(0);
        expect(pos.x + 175).toBeLessThanOrEqual(1300);
        expect(pos.y + 124).toBeLessThanOrEqual(1000);
    });

    it('grows the cluster hull over persisted node rects', () => {
        const layout: NsLayout = {
            // The node rect extends far past the persisted cluster's right edge.
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [{ name: 'worker-1', x: 2000, y: 100, width: 400, height: 300 }],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        const nodes = [node('ConfigMap', 'cm', 150, 150)];
        const result = repairPlacements(nodes, new Set(['ConfigMap-cm']), layout);
        const cluster = result.nsLayout!.cluster;
        // The cluster covers the node rect (hull expansion over node boxes).
        expect(cluster.x + cluster.width).toBeGreaterThanOrEqual(2000 + 400 + 24);
        expect(result.layoutChanged).toBe(true);
    });
});