import { describe, it, expect, beforeEach } from 'vitest';
import { useVeltraStore } from '../store';
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

    it('grows the namespace box (and persists the layout) when the created resource does not fit', () => {
        const small: NsLayout = {
            cluster: { x: 0, y: 0, width: 1200, height: 900 },
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