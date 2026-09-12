import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildGraph,
    nodeIdFor,
    MAX_SYNTHETIC_PODS,
    getVpaTarget,
    getResourcesUsingConfigMap,
    getResourcesUsingSecret,
    getResourcesUsingPvc,
    daemonSetBoxPinKey,
    isDaemonSetSibling,
} from '../buildGraph';
import { connectResources, explainInvalidLink } from '../linkResources';
import type { NamespaceRect, NodeRect } from '../teachingFrame';
import type { K8sResource } from '../../types/types';

function daemonSet(name: string): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'DaemonSet',
        metadata: { name, namespace: 'default', labels: { app: name } },
        spec: {
            selector: { matchLabels: { app: name } },
            template: {
                metadata: { labels: { app: name } },
                spec: {
                    containers: [{ name: 'app', image: 'fluentd:latest' }],
                },
            },
        },
    };
}

const DEFAULT_NS: NamespaceRect = { name: 'default', x: 0, y: 0, width: 1600, height: 900 };
const OTHER_NS: NamespaceRect = { name: 'ops', x: 5000, y: 5000, width: 400, height: 300 };

const worker = (name: string, x: number, y: number): NodeRect => ({
    name,
    x,
    y,
    width: 340,
    height: 280,
});

// Three node rects overlapping the 'default' namespace, plus one far away.
const HOSTING_NODES = [worker('worker-1', 40, 40), worker('worker-2', 420, 40), worker('worker-3', 40, 360)];
const NON_HOSTING_NODE = worker('far-away', 9000, 9000);

const LAYOUT = (nodes: NodeRect[]) => ({ nodes, namespaces: [DEFAULT_NS, OTHER_NS] });

describe('DaemonSet box placement', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('keeps box positions stable across re-derives (no self-blocking toggle)', () => {
        const first = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const boxes = first.nodes.filter((n) => n.data.kind === 'DaemonSet');
        const positions = boxes.map((b) => `${b.data.assignedNode}@${b.position.x},${b.position.y}`);
        // Rebuild with the previous render's nodes as previousNodes — the boxes
        // must stay exactly where they were (their own previous spots are never
        // blockers for their own re-placement).
        const second = buildGraph([daemonSet('collector')], first.nodes, LAYOUT(HOSTING_NODES));
        const positions2 = second.nodes
            .filter((n) => n.data.kind === 'DaemonSet')
            .map((b) => `${b.data.assignedNode}@${b.position.x},${b.position.y}`);
        expect(positions2).toEqual(positions);
    });

    it('honors a saved RELATIVE box pin inside its node rect', () => {
        const rect = HOSTING_NODES[0];
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ [daemonSetBoxPinKey('collector', 'worker-1')]: { x: 60, y: 80 } })
        );
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const box = nodes.find(
            (n) => n.data.kind === 'DaemonSet' && n.data.assignedNode === 'worker-1'
        )!;
        expect(box.position.x).toBe(rect.x + 60);
        expect(box.position.y).toBe(rect.y + 80);
    });

    it('re-sweeps inside the node rect when the pin no longer fits', () => {
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ [daemonSetBoxPinKey('collector', 'worker-1')]: { x: 5000, y: 5000 } })
        );
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const box = nodes.find(
            (n) => n.data.kind === 'DaemonSet' && n.data.assignedNode === 'worker-1'
        )!;
        const rect = HOSTING_NODES[0];
        const w = typeof box.style?.width === 'number' ? box.style.width : 182;
        const h = typeof box.style?.height === 'number' ? box.style.height : 181;
        expect(box.position.x).toBeGreaterThanOrEqual(rect.x);
        expect(box.position.y).toBeGreaterThanOrEqual(rect.y);
        expect(box.position.x + w).toBeLessThanOrEqual(rect.x + rect.width);
        expect(box.position.y + h).toBeLessThanOrEqual(rect.y + rect.height);
    });

    it('treats sibling boxes as one logical resource for name-clash checks', () => {
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        // The edited DaemonSet's own boxes never clash with it…
        boxes.forEach((box) => {
            boxes
                .filter((other) => other.id !== box.id)
                .forEach((other) => {
                    expect(
                        isDaemonSetSibling(other, { kind: 'DaemonSet', name: 'collector' })
                    ).toBe(true);
                });
        });
        // …but a genuinely different DaemonSet name still clashes.
        const otherDs = boxes[0];
        expect(
            isDaemonSetSibling({ ...otherDs, data: { ...otherDs.data, name: 'other-ds' } }, {
                kind: 'DaemonSet',
                name: 'collector',
            })
        ).toBe(false);
        expect(
            isDaemonSetSibling({ ...otherDs, data: { ...otherDs.data, kind: 'Deployment' } }, {
                kind: 'DaemonSet',
                name: 'collector',
            })
        ).toBe(false);
    });
});

describe('DaemonSet materialization', () => {
    it('places one box per hosting node rect, each nesting exactly one Pod', () => {
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT([...HOSTING_NODES, NON_HOSTING_NODE]));
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        // The far-away node rect (outside the namespace) hosts no box.
        expect(boxes).toHaveLength(3);
        boxes.forEach((box) => {
            expect(box.data.namespace).toBe('default');
            expect(box.data.assignedNode).toBeDefined();
            expect(box.draggable).toBe(true); // draggable within its own node rect
            expect(box.data.nodeCount).toBe(3);
        });
        expect(boxes.map((b) => b.data.assignedNode).sort()).toEqual([
            'worker-1',
            'worker-2',
            'worker-3',
        ]);

        // Every box contains exactly one synthetic Pod named <ds>-<node>.
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        expect(pods).toHaveLength(3);
        boxes.forEach((box) => {
            const child = nodes.find((n) => n.parentId === box.id);
            expect(child).toBeDefined();
            expect(child!.data.kind).toBe('Pod');
            expect(child!.data.synthetic).toBe(true);
            expect(child!.data.managedBy).toEqual({ kind: 'DaemonSet', name: 'collector' });
            expect(child!.data.assignedNode).toBe(box.data.assignedNode);
            expect(child!.data.name).toBe(`collector-${box.data.assignedNode}`);
            expect(child!.extent).toBe('parent');
            expect(child!.draggable).toBe(false);
        });
    });

    it('makes the FIRST hosting box the real resource and the rest display-only copies', () => {
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const boxes = nodes
            .filter((n) => n.data.kind === 'DaemonSet')
            .sort((a, b) => (a.data.assignedNode ?? '').localeCompare(b.data.assignedNode ?? ''));
        const real = boxes.find((b) => !b.data.synthetic)!;
        expect(real).toBeDefined();
        expect(real.data.assignedNode).toBe('worker-1'); // first hosting node rect
        boxes
            .filter((b) => b !== real)
            .forEach((b) => {
                expect(b.data.synthetic).toBe(true);
                expect(b.data.managedBy).toEqual({ kind: 'DaemonSet', name: 'collector' });
            });
    });

    it('places every box inside its node rect (box ⊆ node rect bounds)', () => {
        const { nodes } = buildGraph([daemonSet('collector')], [], LAYOUT(HOSTING_NODES));
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        boxes.forEach((box) => {
            const host = HOSTING_NODES.find((n) => n.name === box.data.assignedNode)!;
            const w = typeof box.style?.width === 'number' ? box.style.width : 182;
            const h = typeof box.style?.height === 'number' ? box.style.height : 181;
            expect(box.position.x).toBeGreaterThanOrEqual(host.x);
            expect(box.position.y).toBeGreaterThanOrEqual(host.y);
            expect(box.position.x + w).toBeLessThanOrEqual(host.x + host.width);
            expect(box.position.y + h).toBeLessThanOrEqual(host.y + host.height);
        });
    });

    it('falls back to ONE normal lane card when the namespace covers no node rects', () => {
        const { nodes, autoPlacedIds } = buildGraph([daemonSet('collector')], [], LAYOUT([NON_HOSTING_NODE]));
        const cards = nodes.filter((n) => n.data.kind === 'DaemonSet');
        expect(cards).toHaveLength(1);
        expect(cards[0].data.assignedNode).toBeUndefined();
        expect(cards[0].data.nodeCount).toBe(0);
        expect(cards[0].draggable).toBe(true);
        expect(autoPlacedIds.has(cards[0].id)).toBe(true); // auto-placed + repaired like any workload
        expect(nodes.filter((n) => n.data.kind === 'Pod')).toHaveLength(0);
    });

    it('caps materialization at MAX_SYNTHETIC_PODS but keeps the true node count', () => {
        const many = Array.from({ length: 30 }, (_, i) => worker(`node-${i + 1}`, 40 + (i % 3) * 400, 40 + Math.floor(i / 3) * 320));
        const tallNs = { nodes: many, namespaces: [{ name: 'default', x: 0, y: 0, width: 1600, height: 4000 }] };
        const { nodes } = buildGraph([daemonSet('collector')], [], tallNs);
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        expect(boxes).toHaveLength(MAX_SYNTHETIC_PODS);
        boxes.forEach((b) => expect(b.data.nodeCount).toBe(30));
    });

    it('never claims explicit Pods — a matching Pod stays standalone', () => {
        const explicit: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'collector-worker-1', namespace: 'default', labels: { app: 'collector' } },
            spec: { containers: [{ name: 'c', image: 'img' }] },
        };
        const { nodes } = buildGraph([daemonSet('collector'), explicit], [], LAYOUT([worker('worker-1', 40, 40)]));
        const pods = nodes.filter((n) => n.data.kind === 'Pod');
        // the explicit pod (named like a DS pod but NOT claimed) plus one synthetic
        expect(pods).toHaveLength(2);
        const explicitNode = pods.find((n) => n.data.name === 'collector-worker-1');
        expect(explicitNode?.data.synthetic).toBeUndefined();
        expect(explicitNode?.parentId).toBeUndefined();
        const synthetic = pods.find((n) => n.data.synthetic);
        expect(synthetic?.data.name).toBe('collector-worker-1-2'); // name de-duplicated
    });

    it('draws Service selector edges to the nested Pods', () => {
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'collector-svc', namespace: 'default' },
            spec: { selector: { app: 'collector' }, ports: [{ port: 80 }] },
        };
        const { nodes, edges } = buildGraph([daemonSet('collector'), svc], [], LAYOUT(HOSTING_NODES));
        const svcNode = nodes.find((n) => n.data.kind === 'Service');
        const podEdges = edges.filter(
            (e) => e.source === svcNode!.id && (e.label as string).startsWith('port:')
        );
        expect(podEdges).toHaveLength(3);
        const targets = new Set(podEdges.map((e) => e.target));
        const dsPodIds = nodes
            .filter((n) => n.data.kind === 'Pod' && n.data.managedBy?.kind === 'DaemonSet')
            .map((n) => n.id);
        dsPodIds.forEach((id) => expect(targets.has(id)).toBe(true));
    });

    it('draws a Service→DaemonSet fallback edge when the namespace covers no nodes', () => {
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'collector-svc', namespace: 'default' },
            spec: { selector: { app: 'collector' }, ports: [{ port: 80 }] },
        };
        const { nodes, edges } = buildGraph([daemonSet('collector'), svc], [], LAYOUT([]));
        const svcNode = nodes.find((n) => n.data.kind === 'Service');
        const ds = nodes.find((n) => n.data.kind === 'DaemonSet');
        expect(edges.some((e) => e.source === svcNode!.id && e.target === ds!.id)).toBe(true);
    });

    it('is a valid VPA target and draws a right-sizes edge to EVERY box', () => {
        const vpa: K8sResource = {
            apiVersion: 'autoscaling.k8s.io/v1',
            kind: 'VerticalPodAutoscaler',
            metadata: { name: 'collector-vpa', namespace: 'default' },
            spec: {
                targetRef: { apiVersion: 'apps/v1', kind: 'DaemonSet', name: 'collector' },
                updatePolicy: { updateMode: 'Auto' },
            },
        };
        expect(getVpaTarget(vpa)).toEqual({ kind: 'DaemonSet', name: 'collector' });
        const { nodes, edges } = buildGraph([daemonSet('collector'), vpa], [], LAYOUT(HOSTING_NODES));
        const vpaNode = nodes.find((n) => n.data.kind === 'VerticalPodAutoscaler');
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        const rightSizes = edges.filter((e) => e.source === vpaNode!.id);
        expect(rightSizes).toHaveLength(3);
        boxes.forEach((b) =>
            expect(rightSizes.some((e) => e.target === b.id)).toBe(true)
        );
    });

    it('routes ConfigMap/Secret/PVC references through spec.template.spec and draws uses edges from every box', () => {
        const dsWithRefs: K8sResource = {
            ...daemonSet('collector'),
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: {
                        containers: [
                            {
                                name: 'app',
                                image: 'fluentd:latest',
                                envFrom: [{ configMapRef: { name: 'fluent-cfg' } }],
                                env: [{ name: 'TOKEN', valueFrom: { secretKeyRef: { name: 'fluent-tok', key: 'token' } } }],
                            },
                        ],
                        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'fluent-data' } }],
                    },
                },
            },
        };
        const cm: K8sResource = {
            apiVersion: 'v1',
            kind: 'ConfigMap',
            metadata: { name: 'fluent-cfg', namespace: 'default' },
        };
        const secret: K8sResource = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: { name: 'fluent-tok', namespace: 'default' },
        };
        const pvc: K8sResource = {
            apiVersion: 'v1',
            kind: 'PersistentVolumeClaim',
            metadata: { name: 'fluent-data', namespace: 'default' },
            spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } },
        };
        const { nodes, edges } = buildGraph(
            [dsWithRefs, cm, secret, pvc],
            [],
            LAYOUT(HOSTING_NODES)
        );
        const boxes = nodes.filter((n) => n.data.kind === 'DaemonSet');
        const cmId = nodes.find((n) => n.data.kind === 'ConfigMap')!.id;
        const secretId = nodes.find((n) => n.data.kind === 'Secret')!.id;
        const pvcId = nodes.find((n) => n.data.kind === 'PersistentVolumeClaim')!.id;
        expect(edges.filter((e) => e.label === 'uses' && e.target === cmId)).toHaveLength(3);
        expect(edges.filter((e) => e.label === 'uses' && e.target === secretId)).toHaveLength(3);
        expect(edges.filter((e) => e.label === 'mounts' && e.target === pvcId)).toHaveLength(3);
        boxes.forEach((b) => {
            expect(edges.some((e) => e.source === b.id && e.label === 'uses' && e.target === cmId)).toBe(true);
            expect(edges.some((e) => e.source === b.id && e.label === 'uses' && e.target === secretId)).toBe(true);
            expect(edges.some((e) => e.source === b.id && e.label === 'mounts' && e.target === pvcId)).toBe(true);
        });

        expect(getResourcesUsingConfigMap([dsWithRefs, cm], 'fluent-cfg').map((r) => r.kind)).toContain('DaemonSet');
        expect(getResourcesUsingSecret([dsWithRefs, secret], 'fluent-tok').map((r) => r.kind)).toContain('DaemonSet');
        expect(getResourcesUsingPvc([dsWithRefs, pvc], 'fluent-data').map((r) => r.kind)).toContain('DaemonSet');
    });
});

describe('DaemonSet semantic linking', () => {
    it('Service ↔ DaemonSet sets the Service selector to the pod-template labels', () => {
        const svc: K8sResource = {
            apiVersion: 'v1',
            kind: 'Service',
            metadata: { name: 'collector-svc', namespace: 'default' },
            spec: { ports: [{ port: 80 }] },
        };
        const linked = connectResources([daemonSet('collector'), svc], 0, 1)!;
        const service = linked.resources.find((r) => r.kind === 'Service')!;
        expect((service.spec as any).selector).toEqual({ app: 'collector' });
    });

    it('VPA ↔ DaemonSet writes targetRef with apps/v1', () => {
        const vpa: K8sResource = {
            apiVersion: 'autoscaling.k8s.io/v1',
            kind: 'VerticalPodAutoscaler',
            metadata: { name: 'collector-vpa', namespace: 'default' },
            spec: { updatePolicy: { updateMode: 'Auto' } },
        };
        const linked = connectResources([vpa, daemonSet('collector')], 0, 1)!;
        const patched = linked.resources.find((r) => r.kind === 'VerticalPodAutoscaler')!;
        expect((patched.spec as any).targetRef).toEqual({
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            name: 'collector',
        });
    });

    it('HPA ↔ DaemonSet and DaemonSet ↔ Pod are rejected with guidance', () => {
        const hpa: K8sResource = {
            apiVersion: 'autoscaling/v2',
            kind: 'HorizontalPodAutoscaler',
            metadata: { name: 'collector-hpa', namespace: 'default' },
            spec: { minReplicas: 1, maxReplicas: 10 },
        };
        const pod: K8sResource = {
            apiVersion: 'v1',
            kind: 'Pod',
            metadata: { name: 'orphan', namespace: 'default' },
            spec: {},
        };
        expect(connectResources([hpa, daemonSet('collector')], 0, 1)).toBeNull();
        expect(connectResources([daemonSet('collector'), pod], 0, 1)).toBeNull();
        expect(explainInvalidLink('HorizontalPodAutoscaler', 'DaemonSet')).toMatch(/cluster nodes/);
        expect(explainInvalidLink('DaemonSet', 'Pod')).toMatch(/controller-managed/);
        expect(explainInvalidLink('DaemonSet', 'Ingress')).toMatch(/Service first/);
    });

    it('nodeIdFor produces stable DaemonSet ids', () => {
        expect(nodeIdFor('DaemonSet', 'collector')).toBe('DaemonSet-collector');
    });
});