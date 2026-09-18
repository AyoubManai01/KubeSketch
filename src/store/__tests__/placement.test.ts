import { describe, it, expect, beforeEach } from 'vitest';
import { useVeltraStore, readNsLayout } from '../store';
import type { NsLayout } from '../../utils/teachingFrame';
import type { K8sResource } from '../../types/types';

function deployment(name: string, namespace?: string): K8sResource {
    return {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name, ...(namespace ? { namespace } : {}) },
        spec: {
            replicas: 1,
            selector: { matchLabels: { app: name } },
            template: {
                metadata: { labels: { app: name } },
                spec: { containers: [{ name: 'app', image: 'nginx:latest' }] },
            },
        },
    };
}

function configMap(name: string, namespace: string): K8sResource {
    return {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name, namespace },
        data: { k: 'v' },
    };
}

const LAYOUT: NsLayout = {
    cluster: { x: 0, y: 0, width: 1200, height: 900 },
    nodes: [],
    namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
};

describe('placement through the store', () => {
    beforeEach(() => {
        localStorage.clear();
        useVeltraStore.getState().clearAll();
    });

    const nodeOf = (kind: string, name: string) =>
        useVeltraStore.getState().nodes.find((n) => n.data.kind === kind && n.data.name === name);

    const containedIn = (node: NonNullable<ReturnType<typeof nodeOf>>, rect: { x: number; y: number; width: number; height: number }) => {
        const w = typeof node.style?.width === 'number' ? node.style.width : 180;
        const h = typeof node.style?.height === 'number' ? node.style.height : 104;
        return (
            node.position.x >= rect.x &&
            node.position.y >= rect.y &&
            node.position.x + w <= rect.x + rect.width &&
            node.position.y + h <= rect.y + rect.height
        );
    };

    it('ignores a stale saved position when re-creating a resource — it lands inside its namespace', () => {
        // Pin from a previously dragged-then-deleted resource.
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ 'Deployment:web': { x: 5000, y: 5000 } })
        );
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('Deployment', deployment('web', 'default'));
        const n = nodeOf('Deployment', 'web');
        expect(n).toBeTruthy();
        expect(containedIn(n!, LAYOUT.namespaces[0])).toBe(true);
        // The stale pin is gone from storage.
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['Deployment:web']).toBeUndefined();
    });

    it('tiles the missing node rects over the namespace and materializes one box+Pod per node', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 3 });

        // Three node rects were created over the namespace (canvas-only chrome).
        const nodes = useVeltraStore.getState().nsLayout?.nodes ?? [];
        expect(nodes.map((n) => n.name)).toEqual(['worker-1', 'worker-2', 'worker-3']);
        // The tiles cover the namespace: every tile overlaps the default rect.
        const ns = useVeltraStore.getState().nsLayout!.namespaces[0];
        nodes.forEach((nd) => {
            expect(nd.x < ns.x + ns.width && nd.x + nd.width > ns.x).toBe(true);
            expect(nd.y < ns.y + ns.height && nd.y + nd.height > ns.y).toBe(true);
        });

        // The DaemonSet materializes one box+Pod per hosting node rect.
        const boxes = useVeltraStore
            .getState()
            .nodes.filter((n) => n.data.kind === 'DaemonSet');
        expect(boxes).toHaveLength(3);
        const realBox = boxes.find((b) => !b.data.synthetic)!;
        expect(realBox).toBeDefined();
        expect(realBox.data.nodeCount).toBe(3);
        const dsPods = useVeltraStore
            .getState()
            .nodes.filter((n) => n.data.kind === 'Pod' && n.data.managedBy?.kind === 'DaemonSet');
        expect(dsPods).toHaveLength(3);
        dsPods.forEach((pod) => {
            const hostBox = boxes.find((b) => b.id === pod.parentId);
            expect(hostBox).toBeDefined();
            expect(pod.data.assignedNode).toBe(hostBox!.data.assignedNode);
        });

        // Node rects are persisted in the layout, and never leak into the manifest.
        const savedLayout = JSON.parse(localStorage.getItem('veltra_ns_layout') ?? '{}');
        expect(savedLayout.nodes).toHaveLength(3);
        const yaml = localStorage.getItem('veltra_yaml') ?? '';
        expect(yaml).not.toContain('worker-1');
        expect(yaml).not.toContain('DaemonSet-collector-worker'); // synthetic pods are display-only
    });

    it('counts existing node rects OVER the namespace toward the desired total (1 → 2 created)', () => {
        const withOneNode: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [{ name: 'node-a', x: 300, y: 100, width: 200, height: 150 }],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: withOneNode });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 3 });

        const names = (useVeltraStore.getState().nsLayout?.nodes ?? []).map((n) => n.name);
        expect(names).toHaveLength(3); // node-a (over the ns) + 2 tiles
        const dsPods = useVeltraStore
            .getState()
            .nodes.filter((n) => n.data.kind === 'Pod' && n.data.managedBy?.kind === 'DaemonSet');
        expect(dsPods).toHaveLength(3);
    });

    it('does NOT count node rects elsewhere — all desired nodes are tiled over the namespace', () => {
        const withFarNode: NsLayout = {
            cluster: { x: 0, y: 0, width: 2400, height: 1800 },
            nodes: [{ name: 'node-a', x: 2000, y: 1500, width: 200, height: 150 }],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        };
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: withFarNode });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 3 });

        const nodes = useVeltraStore.getState().nsLayout?.nodes ?? [];
        expect(nodes).toHaveLength(4); // node-a (elsewhere) + 3 tiles over the namespace
        // The far-away node hosts no box — only the 3 tiles host the DS.
        const boxes = useVeltraStore
            .getState()
            .nodes.filter((n) => n.data.kind === 'DaemonSet');
        expect(boxes).toHaveLength(3);
        boxes.forEach((b) => expect(b.data.assignedNode).not.toBe('node-a'));
    });

    it('re-derives DaemonSet boxes on addNode/deleteNode without touching YAML', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 2 });
        expect(useVeltraStore.getState().nodes.filter((n) => n.data.kind === 'DaemonSet')).toHaveLength(2);
        const yamlBefore = localStorage.getItem('veltra_yaml');

        // Adding a node rect in a free pocket (NOT over the namespace) adds no box.
        useVeltraStore.getState().addNode('worker-extra', { x: 2000, y: 2000, width: 340, height: 280 });
        expect(useVeltraStore.getState().nodes.filter((n) => n.data.kind === 'DaemonSet')).toHaveLength(2);
        expect(localStorage.getItem('veltra_yaml')).toBe(yamlBefore); // model/YAML untouched

        // Deleting a hosting node rect removes its box+Pod.
        useVeltraStore.getState().deleteNode('worker-1');
        expect(useVeltraStore.getState().nodes.filter((n) => n.data.kind === 'DaemonSet')).toHaveLength(1);
        expect(localStorage.getItem('veltra_yaml')).toBe(yamlBefore);
    });

    it('pins a dragged DaemonSet box RELATIVE to its node rect', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 2 });
        const rect = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'worker-1')!;
        const box = useVeltraStore
            .getState()
            .nodes.find((n) => n.data.kind === 'DaemonSet' && n.data.assignedNode === 'worker-1')!;
        // Simulate a drag: move the box (fully inside the 260×240 tile), then persist.
        const moved = { ...box, position: { x: rect.x + 30, y: rect.y + 30 } };
        useVeltraStore.setState({ nodes: useVeltraStore.getState().nodes.map((n) => (n.id === box.id ? moved : n)) });
        useVeltraStore.getState().persistNodePositions([box.id]);

        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['DaemonSetBox:collector:worker-1']).toEqual({ x: 30, y: 30 });
        // The shared DaemonSet:<name> key is untouched (boxes never pollute it).
        expect(saved['DaemonSet:collector']).toBeUndefined();

        // Rebuilds keep the box at the pinned spot (relative to the rect).
        useVeltraStore.getState().refreshLayoutDerived();
        const box2 = useVeltraStore
            .getState()
            .nodes.find((n) => n.data.kind === 'DaemonSet' && n.data.assignedNode === 'worker-1')!;
        expect(box2.position.x).toBe(rect.x + 30);
        expect(box2.position.y).toBe(rect.y + 30);
    });

    it('keeps boxes stable across resize + refresh (no toggle)', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 2 });
        const rect = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'worker-1')!;
        const snap = () =>
            useVeltraStore
                .getState()
                .nodes.filter((n) => n.data.kind === 'DaemonSet')
                .map((b) => `${b.data.assignedNode}@${b.position.x},${b.position.y}`)
                .sort();

        // Shrink the hosting node rect (still fits a 182×181 box).
        useVeltraStore.getState().resizeNodeRect('worker-1', {
            x: rect.x,
            y: rect.y,
            width: Math.max(220, rect.width - 40),
            height: Math.max(220, rect.height - 40),
        });
        // The box follows the rect live and stays inside it.
        const box = useVeltraStore
            .getState()
            .nodes.find((n) => n.data.kind === 'DaemonSet' && n.data.assignedNode === 'worker-1')!;
        const newRect = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'worker-1')!;
        const w = typeof box.style?.width === 'number' ? box.style.width : 182;
        const h = typeof box.style?.height === 'number' ? box.style.height : 181;
        expect(box.position.x).toBeGreaterThanOrEqual(newRect.x);
        expect(box.position.y).toBeGreaterThanOrEqual(newRect.y);
        expect(box.position.x + w).toBeLessThanOrEqual(newRect.x + newRect.width);
        expect(box.position.y + h).toBeLessThanOrEqual(newRect.y + newRect.height);

        // Two refreshes → identical positions (the old self-blocking toggle).
        const before = snap();
        useVeltraStore.getState().refreshLayoutDerived();
        useVeltraStore.getState().refreshLayoutDerived();
        expect(snap()).toEqual(before);
    });

    it('renames a DaemonSet with sibling boxes (no false duplicate) and migrates box pins', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 2 });
        // Seed a box pin, then rename the DS via its real box.
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ 'DaemonSetBox:collector:worker-1': { x: 40, y: 50 } })
        );
        const realBox = useVeltraStore
            .getState()
            .nodes.find((n) => n.data.kind === 'DaemonSet' && !n.data.synthetic)!;
        useVeltraStore.getState().updateNodeFromCanvas(realBox.id, { name: 'collector-2' });

        const names = new Set(
            useVeltraStore
                .getState()
                .nodes.filter((n) => n.data.kind === 'DaemonSet')
                .map((n) => n.data.name)
        );
        expect(names).toEqual(new Set(['collector-2']));
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['DaemonSetBox:collector-2:worker-1']).toEqual({ x: 40, y: 50 });
        expect(saved['DaemonSetBox:collector:worker-1']).toBeUndefined();
    });

    it('clears DaemonSet box pins when the DaemonSet is deleted', () => {
        const ds: K8sResource = {
            apiVersion: 'apps/v1',
            kind: 'DaemonSet',
            metadata: { name: 'collector', namespace: 'default' },
            spec: {
                selector: { matchLabels: { app: 'collector' } },
                template: {
                    metadata: { labels: { app: 'collector' } },
                    spec: { containers: [{ name: 'app', image: 'fluentd:latest' }] },
                },
            },
        };
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('DaemonSet', ds, undefined, { desiredNodes: 2 });
        useVeltraStore.getState().persistNodePositions(
            useVeltraStore
                .getState()
                .nodes.filter((n) => n.data.kind === 'DaemonSet')
                .map((n) => n.id)
        );
        expect(Object.keys(JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}'))).toHaveLength(2);
        const realBox = useVeltraStore
            .getState()
            .nodes.find((n) => n.data.kind === 'DaemonSet' && !n.data.synthetic)!;
        useVeltraStore.getState().deleteNodeFromCanvas(realBox.id);
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(Object.keys(saved).filter((k) => k.startsWith('DaemonSetBox:'))).toHaveLength(0);
        expect(useVeltraStore.getState().nodes.filter((n) => n.data.kind === 'DaemonSet')).toHaveLength(0);
    });

    it('grows the namespace box (and persists the layout) when the created resource does not fit', () => {
        const small: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 150, height: 120 }],
        };
        useVeltraStore.setState({ nsLayout: small });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const n = nodeOf('ConfigMap', 'cm')!;
        const ns = useVeltraStore.getState().nsLayout!.namespaces[0];
        expect(containedIn(n, ns)).toBe(true);
        expect(ns.width).toBeGreaterThan(150); // grown
        // The grown layout is persisted so NS-mode edits start from it.
        const persisted = JSON.parse(localStorage.getItem('veltra_ns_layout') ?? '{}');
        expect(persisted.namespaces[0].width).toBeGreaterThan(150);
        // And the cluster covers the grown box.
        const cluster = useVeltraStore.getState().nsLayout!.cluster;
        expect(ns.x + ns.width).toBeLessThanOrEqual(cluster.x + cluster.width);
        expect(ns.y + ns.height).toBeLessThanOrEqual(cluster.y + cluster.height);
    });

    it('re-places a node inside the target namespace on reassignment (inspector/NS-drop)', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [],
            namespaces: [
                { name: 'a', x: 100, y: 100, width: 400, height: 400 },
                { name: 'b', x: 600, y: 100, width: 400, height: 400 },
            ],
        };
        useVeltraStore.setState({ nsLayout: layout });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'a'));
        const before = nodeOf('ConfigMap', 'cm')!;
        expect(containedIn(before, layout.namespaces[0])).toBe(true);
        useVeltraStore.getState().updateNodeFromCanvas(before.id, { namespace: 'b' });
        const after = nodeOf('ConfigMap', 'cm')!;
        expect(after.data.namespace).toBe('b');
        expect(containedIn(after, layout.namespaces[1])).toBe(true);
    });

    it('keeps the migrated position on a rename (not treated as a reassignment)', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const before = nodeOf('ConfigMap', 'cm')!;
        const pos = { ...before.position };
        useVeltraStore.getState().persistNodePositions([before.id]);
        useVeltraStore.getState().updateNodeFromCanvas(before.id, { name: 'cm2' });
        const after = nodeOf('ConfigMap', 'cm2')!;
        expect(after.position).toEqual(pos); // pin migrated, not re-placed
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['ConfigMap:cm2']).toEqual(pos);
        expect(saved['ConfigMap:cm']).toBeUndefined();
    });

    it('clears stale pins for resources typed into the YAML editor', () => {
        localStorage.setItem(
            'veltra_node_positions',
            JSON.stringify({ 'ConfigMap:cm': { x: 5000, y: 5000 } })
        );
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore
            .getState()
            .setYaml(
                'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n  namespace: default\ndata:\n  k: v\n'
            );
        const n = nodeOf('ConfigMap', 'cm');
        expect(n).toBeTruthy();
        expect(containedIn(n!, LAYOUT.namespaces[0])).toBe(true);
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['ConfigMap:cm']).toBeUndefined();
    });

    it('does not disturb existing resources’ pins when YAML only adds new ones', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const n = nodeOf('ConfigMap', 'cm')!;
        const pos = { ...n.position };
        useVeltraStore.getState().persistNodePositions([n.id]);
        useVeltraStore
            .getState()
            .setYaml(
                'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm\n  namespace: default\ndata:\n  k: v\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: s\n  namespace: default\ndata:\n  u: dmFsdWU=\n'
            );
        const after = nodeOf('ConfigMap', 'cm')!;
        expect(after.position).toEqual(pos); // existing pin untouched
        const saved = JSON.parse(localStorage.getItem('veltra_node_positions') ?? '{}');
        expect(saved['ConfigMap:cm']).toEqual(pos);
    });

    it('places a new namespace rect inside the cluster, growing the cluster when needed', () => {
        useVeltraStore.setState({
            nsLayout: {
                cluster: { x: 0, y: 0, width: 400, height: 300 },
                nodes: [],
                namespaces: [{ name: 'a', x: 10, y: 10, width: 380, height: 280 }],
            },
        });
        useVeltraStore.getState().addNamespace('team-b');
        const layout = useVeltraStore.getState().nsLayout!;
        const ns = layout.namespaces.find((n) => n.name === 'team-b')!;
        // The new rect is fully inside the cluster.
        expect(ns.x).toBeGreaterThanOrEqual(layout.cluster.x);
        expect(ns.y).toBeGreaterThanOrEqual(layout.cluster.y);
        expect(ns.x + ns.width).toBeLessThanOrEqual(layout.cluster.x + layout.cluster.width);
        expect(ns.y + ns.height).toBeLessThanOrEqual(layout.cluster.y + layout.cluster.height);
        // The cluster grew to fit it.
        expect(layout.cluster.height).toBeGreaterThan(300);
        expect(layout.cluster.width).toBeGreaterThanOrEqual(400);
    });

    it('sweeps a new namespace rect into a free pocket when the cluster has room', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addNamespace('team-b');
        const layout = useVeltraStore.getState().nsLayout!;
        const a = layout.namespaces.find((n) => n.name === 'default')!;
        const b = layout.namespaces.find((n) => n.name === 'team-b')!;
        expect(b.x + b.width).toBeLessThanOrEqual(layout.cluster.x + layout.cluster.width);
        expect(b.y + b.height).toBeLessThanOrEqual(layout.cluster.y + layout.cluster.height);
        const overlaps =
            b.x < a.x + a.width &&
            b.x + b.width > a.x &&
            b.y < a.y + a.height &&
            b.y + b.height > a.y;
        expect(overlaps).toBe(false);
    });
});

describe('physical nodes through the store', () => {
    beforeEach(() => {
        localStorage.clear();
        useVeltraStore.getState().clearAll();
    });

    const NODE_LAYOUT: NsLayout = {
        cluster: { x: 0, y: 0, width: 1600, height: 1200 },
        nodes: [{ name: 'n1', x: 0, y: 0, width: 600, height: 600 }],
        namespaces: [
            { name: 'default', x: 50, y: 50, width: 300, height: 200 }, // fully inside n1
            { name: 'team-b', x: 500, y: 400, width: 300, height: 300 }, // straddles n1's edge
        ],
    };

    const nodeOf = (kind: string, name: string) =>
        useVeltraStore.getState().nodes.find((n) => n.data.kind === kind && n.data.name === name);

    it('addNode sweeps a new node rect into the cluster without covering namespaces', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().addNode('worker-1');
        const layout = useVeltraStore.getState().nsLayout!;
        const nd = layout.nodes.find((n) => n.name === 'worker-1')!;
        expect(nd).toBeTruthy();
        expect(nd.x).toBeGreaterThanOrEqual(layout.cluster.x);
        expect(nd.y).toBeGreaterThanOrEqual(layout.cluster.y);
        expect(nd.x + nd.width).toBeLessThanOrEqual(layout.cluster.x + layout.cluster.width);
        expect(nd.y + nd.height).toBeLessThanOrEqual(layout.cluster.y + layout.cluster.height);
        const def = layout.namespaces[0];
        const overlaps =
            nd.x < def.x + def.width &&
            nd.x + nd.width > def.x &&
            nd.y < def.y + def.height &&
            nd.y + nd.height > def.y;
        expect(overlaps).toBe(false); // a fresh node starts empty
    });

    it('addNode rejects duplicate names', () => {
        useVeltraStore.setState({ nsLayout: NODE_LAYOUT });
        useVeltraStore.getState().addNode('n1');
        const layout = useVeltraStore.getState().nsLayout!;
        expect(layout.nodes.filter((n) => n.name === 'n1')).toHaveLength(1);
        expect(useVeltraStore.getState().notice?.tone).toBe('error');
    });

    it('grows the cluster when a new node has no free pocket', () => {
        useVeltraStore.setState({
            nsLayout: {
                cluster: { x: 0, y: 0, width: 500, height: 400 },
                nodes: [{ name: 'n1', x: 10, y: 10, width: 480, height: 380 }],
                namespaces: [],
            },
        });
        useVeltraStore.getState().addNode('n2');
        const layout = useVeltraStore.getState().nsLayout!;
        const n2 = layout.nodes.find((n) => n.name === 'n2')!;
        expect(n2.x + n2.width).toBeLessThanOrEqual(layout.cluster.x + layout.cluster.width);
        expect(n2.y + n2.height).toBeLessThanOrEqual(layout.cluster.y + layout.cluster.height);
        expect(layout.cluster.height).toBeGreaterThan(400); // grew to fit
    });

    it('deleteNode removes only the rect — namespaces and resources stay', () => {
        useVeltraStore.setState({ nsLayout: NODE_LAYOUT });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const cm = nodeOf('ConfigMap', 'cm')!;
        const pos = { ...cm.position };
        useVeltraStore.getState().deleteNode('n1');
        const layout = useVeltraStore.getState().nsLayout!;
        expect(layout.nodes.find((n) => n.name === 'n1')).toBeUndefined();
        expect(layout.namespaces.map((n) => n.name).sort()).toEqual(['default', 'team-b']);
        const after = nodeOf('ConfigMap', 'cm')!;
        expect(after.position).toEqual(pos); // resource untouched, still inside its ns
    });

    it('moveNodeRect translates fully-contained namespaces (and their resources) but not straddling ones', () => {
        useVeltraStore.setState({ nsLayout: NODE_LAYOUT });
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const cmBefore = nodeOf('ConfigMap', 'cm')!;
        const cmPos = { ...cmBefore.position };
        const defBefore = { ...useVeltraStore.getState().nsLayout!.namespaces[0] };
        const teamBBefore = { ...useVeltraStore.getState().nsLayout!.namespaces[1] };

        useVeltraStore.getState().moveNodeRect('n1', {
            x: 200,
            y: 100,
            width: 600,
            height: 600,
        });
        const layout = useVeltraStore.getState().nsLayout!;
        const n1 = layout.nodes.find((n) => n.name === 'n1')!;
        expect(n1).toEqual({ name: 'n1', x: 200, y: 100, width: 600, height: 600 });
        // Fully-contained ns 'default' rode along (dx=200, dy=100)…
        const def = layout.namespaces.find((n) => n.name === 'default')!;
        expect(def.x).toBe(defBefore.x + 200);
        expect(def.y).toBe(defBefore.y + 100);
        // …and so did its resource.
        const cm = nodeOf('ConfigMap', 'cm')!;
        expect(cm.position.x).toBe(cmPos.x + 200);
        expect(cm.position.y).toBe(cmPos.y + 100);
        // Straddling ns 'team-b' stays put — it belongs to other nodes too.
        const teamB = layout.namespaces.find((n) => n.name === 'team-b')!;
        expect(teamB).toEqual(teamBBefore);
    });

    it('moveNodeRect pushes the node out of sibling node rects (physical exclusivity)', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [
                { name: 'n1', x: 0, y: 0, width: 600, height: 400 },
                { name: 'n2', x: 700, y: 0, width: 600, height: 400 },
            ],
            namespaces: [],
        };
        useVeltraStore.setState({ nsLayout: layout });
        // Drag n1 so it would overlap n2 — it must be pushed out, not overlapping.
        useVeltraStore.getState().moveNodeRect('n1', {
            x: 500,
            y: 0,
            width: 600,
            height: 400,
        });
        const n1 = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'n1')!;
        expect(n1.x + n1.width).toBeLessThanOrEqual(700); // stops at n2's left edge
    });

    it('resizeNodeRect stops growth at a sibling node rect', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [
                { name: 'n1', x: 0, y: 0, width: 600, height: 400 },
                { name: 'n2', x: 700, y: 0, width: 600, height: 400 },
            ],
            namespaces: [{ name: 'default', x: 50, y: 50, width: 300, height: 200 }],
        };
        useVeltraStore.setState({ nsLayout: layout });
        // East growth straight into n2 must stop at n2's facing edge (x=700).
        useVeltraStore.getState().resizeNodeRect('n1', {
            x: 0,
            y: 0,
            width: 900,
            height: 400,
        });
        const n1 = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'n1')!;
        expect(n1.x + n1.width).toBeLessThanOrEqual(700);
        expect(n1.width).toBeGreaterThanOrEqual(600); // grow-only semantics intact
    });

    it('resizeNodeRect cannot shrink past a namespace it fully contains', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [{ name: 'n1', x: 0, y: 0, width: 600, height: 600 }],
            namespaces: [{ name: 'default', x: 50, y: 50, width: 300, height: 200 }],
        };
        useVeltraStore.setState({ nsLayout: layout });
        // Shrink the node far past its contained namespace — the east edge must
        // stop at the ns rect's facing edge so it never gets evicted.
        useVeltraStore.getState().resizeNodeRect('n1', {
            x: 0,
            y: 0,
            width: 100,
            height: 600,
        });
        const n1 = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'n1')!;
        const def = layout.namespaces[0];
        expect(n1.x + n1.width).toBeGreaterThanOrEqual(def.x + def.width);
    });

    it('moveClusterRect translates node rects too', () => {
        useVeltraStore.setState({ nsLayout: NODE_LAYOUT });
        useVeltraStore.getState().moveClusterRect({
            x: 50,
            y: 50,
            width: 1600,
            height: 1200,
        });
        const layout = useVeltraStore.getState().nsLayout!;
        const n1 = layout.nodes.find((n) => n.name === 'n1')!;
        expect(n1.x).toBe(50);
        expect(n1.y).toBe(50);
        // Namespaces translate too.
        const def = layout.namespaces.find((n) => n.name === 'default')!;
        expect(def.x).toBe(100);
        expect(def.y).toBe(100);
    });

    it('reads a pre-node layout from storage back-compat (no `nodes` key → empty list)', () => {
        localStorage.setItem(
            'veltra_ns_layout',
            JSON.stringify({
                cluster: { x: 0, y: 0, width: 1200, height: 900 },
                namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
            })
        );
        const layout = readNsLayout();
        expect(layout).toEqual({
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
            nodes: [],
            namespaces: [{ name: 'default', x: 100, y: 100, width: 500, height: 500 }],
        });
    });

    it('round-trips node rects through veltra_ns_layout', () => {
        useVeltraStore.setState({ nsLayout: NODE_LAYOUT });
        useVeltraStore.getState().setNsEditMode(false); // persists the layout
        const saved = JSON.parse(localStorage.getItem('veltra_ns_layout') ?? '{}');
        expect(saved.nodes).toEqual(NODE_LAYOUT.nodes);
    });
});

describe('frame editing modes + cluster containment through the store', () => {
    beforeEach(() => {
        localStorage.clear();
        useVeltraStore.getState().clearAll();
    });

    const nodeOf = (kind: string, name: string) =>
        useVeltraStore.getState().nodes.find((n) => n.data.kind === kind && n.data.name === name);

    it('entering node mode exits namespace mode and persists the shared layout', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT, nsEditMode: true });
        useVeltraStore.getState().setNodeEditMode(true);
        const s = useVeltraStore.getState();
        expect(s.nsEditMode).toBe(false);
        expect(s.nodeEditMode).toBe(true);
        const saved = JSON.parse(localStorage.getItem('veltra_ns_layout') ?? '{}');
        expect(saved.namespaces[0].name).toBe('default');
    });

    it('entering namespace mode exits node mode', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT, nodeEditMode: true });
        useVeltraStore.getState().setNsEditMode(true);
        const s = useVeltraStore.getState();
        expect(s.nodeEditMode).toBe(false);
        expect(s.nsEditMode).toBe(true);
    });

    it('exiting node mode persists the layout (like Done)', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT, nodeEditMode: true });
        useVeltraStore.getState().setNodeEditMode(false);
        expect(useVeltraStore.getState().nodeEditMode).toBe(false);
        const saved = JSON.parse(localStorage.getItem('veltra_ns_layout') ?? '{}');
        expect(saved.namespaces[0].name).toBe('default');
    });

    it('clearAll resets both frame modes', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT, nsEditMode: true, nodeEditMode: true });
        useVeltraStore.getState().clearAll();
        const s = useVeltraStore.getState();
        expect(s.nsEditMode).toBe(false);
        expect(s.nodeEditMode).toBe(false);
    });

    it('moveNamespace never lets a dragged namespace leave the cluster', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT }); // cluster 1200x900, ns default 100,100 500x500
        useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
        const cmBefore = nodeOf('ConfigMap', 'cm')!.position;
        // Drag far beyond the cluster's right edge.
        useVeltraStore.getState().moveNamespace('default', { x: 5000, y: 100, width: 500, height: 500 });
        const layout = useVeltraStore.getState().nsLayout!;
        const ns = layout.namespaces[0];
        const cluster = layout.cluster;
        expect(ns.x + ns.width).toBeLessThanOrEqual(cluster.x + cluster.width);
        expect(ns.x).toBe(cluster.x + cluster.width - 500); // pinned to the east edge
        // The ride-along resource translated by the CLAMPED delta (600), not 4900.
        const cm = nodeOf('ConfigMap', 'cm')!;
        expect(cm.position.x - cmBefore.x).toBe(ns.x - 100);
        expect(cm.position.y - cmBefore.y).toBe(0);
    });

    it('moveNamespace keeps a dragged namespace inside the cluster vertically too', () => {
        useVeltraStore.setState({ nsLayout: LAYOUT });
        useVeltraStore.getState().moveNamespace('default', { x: 100, y: 9000, width: 500, height: 500 });
        const layout = useVeltraStore.getState().nsLayout!;
        const ns = layout.namespaces[0];
        const cluster = layout.cluster;
        expect(ns.y + ns.height).toBeLessThanOrEqual(cluster.y + cluster.height);
        expect(ns.y).toBe(cluster.y + cluster.height - 500);
    });

    it('moveNodeRect never lets a dragged node leave the cluster', () => {
        const layout: NsLayout = {
            cluster: { x: 0, y: 0, width: 1600, height: 1200 },
            nodes: [{ name: 'n1', x: 0, y: 0, width: 600, height: 600 }],
            namespaces: [],
        };
        useVeltraStore.setState({ nsLayout: layout });
        useVeltraStore.getState().moveNodeRect('n1', { x: 9000, y: 9000, width: 600, height: 600 });
        const n1 = useVeltraStore.getState().nsLayout!.nodes.find((n) => n.name === 'n1')!;
        expect(n1.x).toBe(1000); // 1600 - 600
        expect(n1.y).toBe(600); // 1200 - 600
        expect(n1.x + n1.width).toBeLessThanOrEqual(1600);
        expect(n1.y + n1.height).toBeLessThanOrEqual(1200);
    });

    describe('namespace deletion (no protected namespaces)', () => {
        it('an empty "default" namespace rectangle can be deleted', () => {
            useVeltraStore.setState({ nsLayout: LAYOUT });
            useVeltraStore.getState().deleteNamespace('default');
            const layout = useVeltraStore.getState().nsLayout!;
            expect(layout.namespaces.map((ns) => ns.name)).toEqual([]);
        });

        it('deleting "default" cascades the resources living in it', () => {
            useVeltraStore.setState({ nsLayout: LAYOUT });
            useVeltraStore.getState().addConfiguredNode('ConfigMap', configMap('cm', 'default'));
            useVeltraStore.getState().deleteNamespace('default');
            expect(nodeOf('ConfigMap', 'cm')).toBeUndefined();
            expect(useVeltraStore.getState().nsLayout!.namespaces).toEqual([]);
        });
    });
});