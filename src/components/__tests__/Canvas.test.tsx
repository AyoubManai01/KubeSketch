import { describe, it, beforeEach, expect, vi } from 'vitest';
import { render, screen as dom, fireEvent } from '@testing-library/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import Canvas from '../Canvas';
import {
    createMockEdge,
    createMockNode,
    getCapturedReactFlowProps,
    resetCapturedReactFlowProps,
    resetMockStoreState,
    setMockStoreState,
    clock,
} from './mocks';

// `vi.mock` is hoisted above this file's own static imports, so each factory
// dynamically imports './mocks' itself rather than closing over a statically
// imported reference (which would hit a temporal-dead-zone ReferenceError).
vi.mock('../../store/store', async () => (await import('./mocks')).storeMockFactory());
vi.mock('@xyflow/react', async () => (await import('./mocks')).xyflowMockFactory());
vi.mock('@xyflow/react/dist/style.css', () => ({}));
// CreateResourceModal has its own dedicated spec file — stub it here so Canvas
// tests only assert *that* it's opened with the right kind and wired to close,
// not how it behaves internally.
vi.mock('../CreateResourceModal', async () => (await import('./mocks')).createResourceModalMockFactory());

/** Find an inspector <input>/<select> by its visible field label (fields aren't htmlFor-linked). */
function fieldByLabel(container: HTMLElement, labelText: string): HTMLInputElement | HTMLSelectElement {
    const labels = Array.from(container.querySelectorAll('.inspector-field__label'));
    const label = labels.find((el) => (el.textContent ?? '').trim().startsWith(labelText));
    if (!label) throw new Error(`No inspector field labeled "${labelText}"`);
    const field = label.closest('.inspector-field');
    const input = field?.querySelector('input, select');
    if (!input) throw new Error(`No input/select under field "${labelText}"`);
    return input as HTMLInputElement | HTMLSelectElement;
}

function selectNode(node: ReturnType<typeof createMockNode>, extra: Record<string, unknown> = {}) {
    setMockStoreState({
        nodes: [node],
        selectedResource: { kind: node.data.kind, name: node.data.name },
        ...extra,
    });
}

describe('Canvas', () => {
    beforeEach(() => {
        resetMockStoreState();
        resetCapturedReactFlowProps();
    });

    // ── Empty state ──────────────────────────────────────────────────────────
    describe('empty state', () => {
        it('shows the empty-canvas illustration and CTAs only when there are no nodes', () => {
            setMockStoreState({ nodes: [] });
            render(<Canvas />);
            expect(dom.getByText('Empty Infrastructure Canvas')).toBeInTheDocument();
        });

        it('hides the empty state once at least one node exists', () => {
            setMockStoreState({ nodes: [createMockNode({ kind: 'Pod', name: 'p1' })] });
            render(<Canvas />);
            expect(dom.queryByText('Empty Infrastructure Canvas')).toBeNull();
        });

        it('the "+ Add Deployment" CTA opens the creation modal pre-set to Deployment', () => {
            setMockStoreState({ nodes: [] });
            render(<Canvas />);
            fireEvent.click(dom.getByText('+ Add Deployment'));
            expect(dom.getByTestId('create-modal-mock')).toHaveAttribute('data-kind', 'Deployment');
        });
    });

    // ── Toolbar ──────────────────────────────────────────────────────────────
    describe('toolbar', () => {
        it('renders one "+ <Kind>" button per supported kind, each opening the modal for that kind', () => {
            setMockStoreState({ nodes: [] });
            render(<Canvas />);
            fireEvent.click(dom.getByText('+ Service'));
            expect(dom.getByTestId('create-modal-mock')).toHaveAttribute('data-kind', 'Service');
        });

        it('closing the modal (its onClose) removes it from the DOM', () => {
            setMockStoreState({ nodes: [] });
            render(<Canvas />);
            fireEvent.click(dom.getByText('+ Pod'));
            fireEvent.click(dom.getByText('close-modal'));
            expect(dom.queryByTestId('create-modal-mock')).toBeNull();
        });
    });

    // ── Invariant: dragging never touches YAML (onNodesChange split) ──────────
    // CLAUDE.md invariant #3: position/select/dimensions-only changes must go
    // through setCanvasNodesPositionOnly, never setCanvasNodes (which triggers a
    // resource rebuild + YAML re-serialize).
    describe('onNodesChange — position vs. structural change routing', () => {
        it('routes a position-only change to setCanvasNodesPositionOnly, not setCanvasNodes', () => {
            const setCanvasNodes = vi.fn();
            const setCanvasNodesPositionOnly = vi.fn();
            setMockStoreState({
                nodes: [createMockNode({ kind: 'Pod', name: 'p1' })],
                setCanvasNodes,
                setCanvasNodesPositionOnly,
            });
            render(<Canvas />);
            const changes: NodeChange[] = [
                { type: 'position', id: 'Pod-p1', position: { x: 10, y: 10 }, dragging: true } as NodeChange,
            ];
            getCapturedReactFlowProps().onNodesChange(changes);

            expect(setCanvasNodesPositionOnly).toHaveBeenCalled();
            expect(setCanvasNodes).not.toHaveBeenCalled();
        });

        it('routes select-only and dimensions-only changes to setCanvasNodesPositionOnly as well', () => {
            const setCanvasNodes = vi.fn();
            const setCanvasNodesPositionOnly = vi.fn();
            setMockStoreState({
                nodes: [createMockNode({ kind: 'Pod', name: 'p1' })],
                setCanvasNodes,
                setCanvasNodesPositionOnly,
            });
            render(<Canvas />);
            const changes: NodeChange[] = [
                { type: 'select', id: 'Pod-p1', selected: true } as NodeChange,
                { type: 'dimensions', id: 'Pod-p1', dimensions: { width: 220, height: 130 } } as NodeChange,
            ];
            getCapturedReactFlowProps().onNodesChange(changes);

            expect(setCanvasNodesPositionOnly).toHaveBeenCalled();
            expect(setCanvasNodes).not.toHaveBeenCalled();
        });

        it('routes any structural change (e.g. remove) to setCanvasNodes, never the position-only setter', () => {
            const setCanvasNodes = vi.fn();
            const setCanvasNodesPositionOnly = vi.fn();
            setMockStoreState({
                nodes: [createMockNode({ kind: 'Pod', name: 'p1' })],
                setCanvasNodes,
                setCanvasNodesPositionOnly,
            });
            render(<Canvas />);
            const changes: NodeChange[] = [{ type: 'remove', id: 'Pod-p1' } as NodeChange];
            getCapturedReactFlowProps().onNodesChange(changes);

            expect(setCanvasNodes).toHaveBeenCalled();
            expect(setCanvasNodesPositionOnly).not.toHaveBeenCalled();
        });

        it('treats a mixed batch (one structural change among position changes) as structural overall', () => {
            const setCanvasNodes = vi.fn();
            const setCanvasNodesPositionOnly = vi.fn();
            setMockStoreState({
                nodes: [createMockNode({ kind: 'Pod', name: 'p1' })],
                setCanvasNodes,
                setCanvasNodesPositionOnly,
            });
            render(<Canvas />);
            const changes: NodeChange[] = [
                { type: 'position', id: 'Pod-p1', position: { x: 1, y: 1 } } as NodeChange,
                { type: 'remove', id: 'Pod-p1' } as NodeChange,
            ];
            getCapturedReactFlowProps().onNodesChange(changes);

            expect(setCanvasNodes).toHaveBeenCalled();
            expect(setCanvasNodesPositionOnly).not.toHaveBeenCalled();
        });
    });

    // ── Invariant: only dragged nodes get pinned ───────────────────────────────
    describe('onNodeDragStop — position persistence', () => {
        it('persists positions for every node in the drag batch when multiple nodes moved together', () => {
            const persistNodePositions = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' });
            setMockStoreState({ nodes: [node], persistNodePositions });
            render(<Canvas />);

            const other = createMockNode({ kind: 'Pod', name: 'p2' });
            getCapturedReactFlowProps().onNodeDragStop(null, node, [node, other]);

            expect(persistNodePositions).toHaveBeenCalledWith([node.id, other.id]);
        });

        it('falls back to the single dragged node when React Flow reports an empty batch', () => {
            const persistNodePositions = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' });
            setMockStoreState({ nodes: [node], persistNodePositions });
            render(<Canvas />);

            getCapturedReactFlowProps().onNodeDragStop(null, node, []);

            expect(persistNodePositions).toHaveBeenCalledWith([node.id]);
        });
    });

    // ── DaemonSet sibling boxes drag independently ──────────────────────────────
    // All sibling boxes of a DaemonSet share the {kind, name} selection, so React
    // Flow reports them all as "dragged" even though only one box was grabbed —
    // only the grabbed box may move (and be pinned), its siblings stay put.
    describe('DaemonSet sibling boxes — independent drags', () => {
        const box = (id: string, x: number, y: number, node: string) =>
            createMockNode(
                {
                    kind: 'DaemonSet',
                    name: 'collector',
                    assignedNode: node,
                    synthetic: true,
                    managedBy: { kind: 'DaemonSet', name: 'collector' },
                    resource: {
                        apiVersion: 'apps/v1',
                        kind: 'DaemonSet',
                        metadata: { name: 'collector' },
                        spec: {},
                    },
                },
                { id, position: { x, y } },
            );
        const box1 = () => box('DaemonSet-collector-worker-1', 100, 100, 'worker-1');
        const box2 = () => box('DaemonSet-collector-worker-2', 500, 100, 'worker-2');

        it('applies the grabbed box\'s position change but drops the sibling\'s', () => {
            const setCanvasNodesPositionOnly = vi.fn();
            setMockStoreState({
                nodes: [box1(), box2()],
                selectedResource: { kind: 'DaemonSet', name: 'collector' },
                setCanvasNodesPositionOnly,
            });
            render(<Canvas />);
            const props = getCapturedReactFlowProps();

            // The user clicked one box (every sibling highlights as one logical
            // resource), then grabbed it — React Flow drags the whole batch.
            props.onNodeDragStart(null, box1(), [box1(), box2()]);
            props.onNodesChange([
                { type: 'position', id: 'DaemonSet-collector-worker-1', position: { x: 120, y: 110 }, dragging: true } as NodeChange,
                { type: 'position', id: 'DaemonSet-collector-worker-2', position: { x: 520, y: 110 }, dragging: true } as NodeChange,
            ]);

            const next = setCanvasNodesPositionOnly.mock.calls[0][0] as Array<{
                id: string;
                position: { x: number; y: number };
            }>;
            expect(next.find((n) => n.id === 'DaemonSet-collector-worker-1')?.position).toEqual({
                x: 120,
                y: 110,
            });
            expect(next.find((n) => n.id === 'DaemonSet-collector-worker-2')?.position).toEqual({
                x: 500,
                y: 100,
            });
        });

        it('pins only the grabbed box on drop — the sibling keeps its placement', () => {
            const persistNodePositions = vi.fn();
            setMockStoreState({
                nodes: [box1(), box2()],
                selectedResource: { kind: 'DaemonSet', name: 'collector' },
                persistNodePositions,
            });
            render(<Canvas />);
            const props = getCapturedReactFlowProps();

            props.onNodeDragStart(null, box1(), [box1(), box2()]);
            props.onNodesChange([
                { type: 'position', id: 'DaemonSet-collector-worker-1', position: { x: 120, y: 110 }, dragging: true } as NodeChange,
                { type: 'position', id: 'DaemonSet-collector-worker-2', position: { x: 520, y: 110 }, dragging: true } as NodeChange,
            ]);
            props.onNodeDragStop(null, box1(), [box1(), box2()]);

            expect(persistNodePositions).toHaveBeenCalledWith(['DaemonSet-collector-worker-1']);
        });
    });

    // ── Thin passthroughs to the store ─────────────────────────────────────────
    describe('canvas event passthroughs', () => {
        it('onConnect forwards the Connection object to addCanvasEdge unmodified', () => {
            const addCanvasEdge = vi.fn();
            setMockStoreState({ addCanvasEdge });
            render(<Canvas />);
            const connection: Connection = { source: 'Service-svc', target: 'Pod-p1', sourceHandle: null, targetHandle: null };
            getCapturedReactFlowProps().onConnect(connection);
            expect(addCanvasEdge).toHaveBeenCalledWith(connection);
        });

        it('onEdgesChange forwards changes to applyCanvasEdgeChanges unmodified', () => {
            const applyCanvasEdgeChanges = vi.fn();
            setMockStoreState({ applyCanvasEdgeChanges });
            render(<Canvas />);
            const changes: EdgeChange[] = [{ type: 'select', id: 'e1', selected: true } as EdgeChange];
            getCapturedReactFlowProps().onEdgesChange(changes);
            expect(applyCanvasEdgeChanges).toHaveBeenCalledWith(changes);
        });

        it('clicking a node selects it by {kind, name}, not by node id', () => {
            const setSelectedResource = vi.fn();
            const node = createMockNode({ kind: 'Deployment', name: 'web' });
            setMockStoreState({ nodes: [node], setSelectedResource });
            render(<Canvas />);
            getCapturedReactFlowProps().onNodeClick(null, node);
            expect(setSelectedResource).toHaveBeenCalledWith({ kind: 'Deployment', name: 'web' });
        });

        it('clicking empty canvas space clears the selection', () => {
            const setSelectedResource = vi.fn();
            setMockStoreState({ setSelectedResource });
            render(<Canvas />);
            getCapturedReactFlowProps().onPaneClick();
            expect(setSelectedResource).toHaveBeenCalledWith(null);
        });
    });

    // ── Inspector: empty vs. populated ─────────────────────────────────────────
    describe('inspector — no selection', () => {
        it('shows the "select a resource" placeholder and no close button', () => {
            setMockStoreState({ selectedResource: null, nodes: [] });
            const { container } = render(<Canvas />);
            expect(
                dom.getByText('Select a resource on the canvas to inspect and edit its properties.')
            ).toBeInTheDocument();
            expect(container.querySelector('.node-inspector__close')).toBeNull();
        });
    });

    // ── Inspector: General section ──────────────────────────────────────────────
    describe('inspector — General section', () => {
        it('shows the hero kind badge and name for the selected resource', () => {
            selectNode(createMockNode({ kind: 'Deployment', name: 'checkout' }));
            render(<Canvas />);
            expect(dom.getByText('checkout')).toBeInTheDocument();
        });

        it('commits a namespace edit through updateNodeFromCanvas', () => {
            const updateNodeFromCanvas = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' });
            selectNode(node, { updateNodeFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Namespace'), { target: { value: 'staging' } });

            expect(updateNodeFromCanvas).toHaveBeenCalledWith(node.id, { namespace: 'staging' });
        });

        it('commits a Resource Type (kind) change through updateNodeFromCanvas', () => {
            const updateNodeFromCanvas = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' });
            selectNode(node, { updateNodeFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Resource Type'), { target: { value: 'Service' } });

            expect(updateNodeFromCanvas).toHaveBeenCalledWith(node.id, { kind: 'Service' });
        });

        it('the Name field blocks a duplicate name (of the same kind) and never commits it', () => {
            const updateNodeFromCanvas = vi.fn();
            const selected = createMockNode({ kind: 'Deployment', name: 'api' });
            const other = createMockNode({ kind: 'Deployment', name: 'web' });
            setMockStoreState({
                nodes: [selected, other],
                selectedResource: { kind: 'Deployment', name: 'api' },
                updateNodeFromCanvas,
            });
            const { container } = render(<Canvas />);

            const nameInput = fieldByLabel(container, 'Name');
            fireEvent.change(nameInput, { target: { value: 'web' } });

            expect(dom.getByText('A Deployment named “web” already exists.')).toBeInTheDocument();
            expect(updateNodeFromCanvas).not.toHaveBeenCalled();
        });

        it('the Name field commits a valid, non-colliding rename', () => {
            const updateNodeFromCanvas = vi.fn();
            const node = createMockNode({ kind: 'Deployment', name: 'api' });
            selectNode(node, { updateNodeFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'api-v2' } });

            expect(updateNodeFromCanvas).toHaveBeenCalledWith(node.id, { name: 'api-v2' });
        });
    });

    // ── Inspector: Metadata section ─────────────────────────────────────────────
    describe('inspector — Metadata section', () => {
        it('parses "k=v,k2=v2" into a labels object and preserves the rest of the resource untouched', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' }, {});
            node.data.resource = {
                apiVersion: 'v1',
                kind: 'Pod',
                metadata: { name: 'p1', namespace: 'default', annotations: { owner: 'team-a' } },
                spec: { containers: [{ name: 'app', image: 'nginx' }] },
            };
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Labels'), { target: { value: 'app=my-app,tier=frontend' } });

            expect(updateNodeResourceFromCanvas).toHaveBeenCalledWith(node.id, {
                apiVersion: 'v1',
                kind: 'Pod',
                metadata: {
                    name: 'p1',
                    namespace: 'default',
                    annotations: { owner: 'team-a' },
                    labels: { app: 'my-app', tier: 'frontend' },
                },
                spec: { containers: [{ name: 'app', image: 'nginx' }] },
            });
        });
    });

    // ── Inspector: Scaling section (Deployment / ReplicaSet) ────────────────────
    describe('inspector — Scaling section', () => {
        it('commits a parsed replica count', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({
                kind: 'Deployment',
                name: 'web',
                resource: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web' }, spec: { replicas: 3 } },
            });
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Replicas'), { target: { value: '7' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as { replicas: number }).replicas).toBe(7);
        });

        it('clearing Replicas commits undefined rather than 0 or NaN', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({
                kind: 'Deployment',
                name: 'web',
                resource: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web' }, spec: { replicas: 3 } },
            });
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Replicas'), { target: { value: '' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as { replicas: unknown }).replicas).toBeUndefined();
        });

        it('picking a selector value sets spec.selector.matchLabels.app to that value', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const target = createMockNode({
                kind: 'Deployment',
                name: 'web',
                resource: { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'web' }, spec: {} },
            });
            const candidate = createMockNode({
                kind: 'Pod',
                name: 'cache-1',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Pod',
                    metadata: { name: 'cache-1', labels: { app: 'cache' } },
                    spec: {},
                },
            });
            setMockStoreState({
                nodes: [target, candidate],
                selectedResource: { kind: 'Deployment', name: 'web' },
                updateNodeResourceFromCanvas,
            });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Selector'), { target: { value: 'cache' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).selector).toEqual({ matchLabels: { app: 'cache' } });
        });
    });

    // ── Inspector: Containers section (Pod) ──────────────────────────────────────
    describe('inspector — Containers section (Pod)', () => {
        it('editing the container name preserves other container fields (e.g. ports)', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({
                kind: 'Pod',
                name: 'p1',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Pod',
                    metadata: { name: 'p1' },
                    spec: { containers: [{ name: 'app', image: 'nginx:latest', ports: [{ containerPort: 8080 }] }] },
                },
            });
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Container Name'), { target: { value: 'api' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).containers[0]).toEqual({
                name: 'api',
                image: 'nginx:latest',
                ports: [{ containerPort: 8080 }],
            });
        });
    });

    // ── Inspector: Networking section (Service) ──────────────────────────────────
    describe('inspector — Networking section (Service)', () => {
        function serviceNode() {
            return createMockNode({
                kind: 'Service',
                name: 'svc',
                resource: {
                    apiVersion: 'v1',
                    kind: 'Service',
                    metadata: { name: 'svc' },
                    spec: { type: 'ClusterIP', ports: [{ port: 80, targetPort: 8080 }] },
                },
            });
        }

        it('a numeric Target Port commits as a number', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Target Port'), { target: { value: '9090' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).ports[0].targetPort).toBe(9090);
        });

        it('a non-numeric Target Port (named port) is preserved as a string rather than dropped', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Target Port'), { target: { value: 'http' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).ports[0].targetPort).toBe('http');
        });

        it('clearing Target Port commits undefined', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Target Port'), { target: { value: '' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).ports[0].targetPort).toBeUndefined();
        });

        it('changing Service Type commits the new type', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Service Type'), { target: { value: 'LoadBalancer' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).type).toBe('LoadBalancer');
        });

        it('selecting "(default: ClusterIP)" commits type as undefined rather than the literal string', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Service Type'), { target: { value: '' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).type).toBeUndefined();
        });

        it('changing Port commits a parsed number', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = serviceNode();
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Port'), { target: { value: '443' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            expect((resource.spec as any).ports[0].port).toBe(443);
        });
    });

    // ── Inspector: Routing section (Ingress) ─────────────────────────────────────
    describe('inspector — Routing section (Ingress)', () => {
        it('selecting a backend Service preserves the existing backend port number', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const svc = createMockNode({ kind: 'Service', name: 'checkout-svc' });
            const ing = createMockNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: {
                        rules: [
                            {
                                http: {
                                    paths: [
                                        { path: '/', backend: { service: { name: 'old-svc', port: { number: 8443 } } } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            });
            setMockStoreState({
                nodes: [ing, svc],
                selectedResource: { kind: 'Ingress', name: 'ing' },
                updateNodeResourceFromCanvas,
            });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Backend Service'), { target: { value: 'checkout-svc' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            const backend = (resource.spec as any).rules[0].http.paths[0].backend;
            expect(backend).toEqual({ service: { name: 'checkout-svc', port: { number: 8443 } } });
        });

        it('defaults a fresh backend to port 80 when none was previously set', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const svc = createMockNode({ kind: 'Service', name: 'checkout-svc' });
            const ing = createMockNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: { rules: [{ http: { paths: [{ path: '/' }] } }] },
                },
            });
            setMockStoreState({
                nodes: [ing, svc],
                selectedResource: { kind: 'Ingress', name: 'ing' },
                updateNodeResourceFromCanvas,
            });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Backend Service'), { target: { value: 'checkout-svc' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            const backend = (resource.spec as any).rules[0].http.paths[0].backend;
            expect(backend).toEqual({ service: { name: 'checkout-svc', port: { number: 80 } } });
        });

        it('changing Host commits into rules[0].host, preserving the rest of the rule', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: { rules: [{ http: { paths: [{ path: '/api', pathType: 'Prefix' }] } }] },
                },
            });
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Host'), { target: { value: 'my-app.example.com' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            const rule = (resource.spec as any).rules[0];
            expect(rule.host).toBe('my-app.example.com');
            expect(rule.http.paths[0]).toEqual({ path: '/api', pathType: 'Prefix' });
        });

        it('changing Path commits into rules[0].http.paths[0].path, preserving the backend', () => {
            const updateNodeResourceFromCanvas = vi.fn();
            const node = createMockNode({
                kind: 'Ingress',
                name: 'ing',
                resource: {
                    apiVersion: 'networking.k8s.io/v1',
                    kind: 'Ingress',
                    metadata: { name: 'ing' },
                    spec: {
                        rules: [
                            {
                                host: 'my-app.example.com',
                                http: {
                                    paths: [
                                        { path: '/', backend: { service: { name: 'checkout-svc', port: { number: 80 } } } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            });
            selectNode(node, { updateNodeResourceFromCanvas });
            const { container } = render(<Canvas />);

            fireEvent.change(fieldByLabel(container, 'Path'), { target: { value: '/api' } });

            const [, resource] = updateNodeResourceFromCanvas.mock.calls[0] as [string, any];
            const rule = (resource.spec as any).rules[0];
            expect(rule.host).toBe('my-app.example.com');
            expect(rule.http.paths[0].path).toBe('/api');
            expect(rule.http.paths[0].backend).toEqual({ service: { name: 'checkout-svc', port: { number: 80 } } });
        });
    });

    // ── Invariant: synthetic/managed resources are inspectable but not editable ──
    describe('managed (synthetic) resource guard', () => {
        function managedNode() {
            return createMockNode({
                kind: 'Pod',
                name: 'web-abcde-x1',
                synthetic: true,
                managedBy: { kind: 'ReplicaSet', name: 'web-abcde' },
                resource: {
                    apiVersion: 'v1',
                    kind: 'Pod',
                    metadata: { name: 'web-abcde-x1', namespace: 'default' },
                    spec: { containers: [{ name: 'app', image: 'nginx:latest' }] },
                },
            });
        }

        it('shows the "Managed by" banner and hides editable General/Metadata sections', () => {
            selectNode(managedNode());
            const { container } = render(<Canvas />);

            expect(dom.getByText('Managed by ReplicaSet web-abcde')).toBeInTheDocument();
            // General/Metadata sections are swapped for a read-only Details panel.
            expect(dom.queryByText('Resource Type')).toBeNull();
            expect(dom.queryByText('Labels')).toBeNull();
            expect(container.querySelector('.inspector-managed-banner')).toBeInTheDocument();
        });

        it('the footer shows a guard message instead of a Delete button', () => {
            selectNode(managedNode());
            render(<Canvas />);
            expect(dom.queryByText('Delete Resource')).toBeNull();
            expect(dom.getByText(/Managed resources can't be deleted directly/)).toBeInTheDocument();
        });

        it('"Inspect <owner>" navigates the selection to the owning ReplicaSet', () => {
            const setSelectedResource = vi.fn();
            selectNode(managedNode(), { setSelectedResource });
            render(<Canvas />);

            fireEvent.click(dom.getByText('Inspect ReplicaSet'));

            expect(setSelectedResource).toHaveBeenCalledWith({ kind: 'ReplicaSet', name: 'web-abcde' });
        });
    });

    // ── Relationships section ────────────────────────────────────────────────────
    describe('inspector — Relationships section', () => {
        it('lists edge-based relationships and containment together, and navigates on click', () => {
            const setSelectedResource = vi.fn();
            const dep = createMockNode({ kind: 'Deployment', name: 'web' });
            const svc = createMockNode({ kind: 'Service', name: 'web-svc' });
            const pod = createMockNode({ kind: 'Pod', name: 'web-pod' }, { parentId: dep.id });
            setMockStoreState({
                nodes: [dep, svc, pod],
                edges: [createMockEdge({ id: 'e1', source: svc.id, target: dep.id, label: 'routes to' })],
                selectedResource: { kind: 'Deployment', name: 'web' },
                setSelectedResource,
            });
            render(<Canvas />);

            expect(dom.getByText('Relationships')).toBeInTheDocument();
            expect(dom.getByText('web-svc')).toBeInTheDocument(); // incoming edge from the Service
            expect(dom.getByText('web-pod')).toBeInTheDocument(); // owned child

            fireEvent.click(dom.getByText('web-svc'));
            expect(setSelectedResource).toHaveBeenCalledWith({ kind: 'Service', name: 'web-svc' });
        });
    });

    // ── YAML preview ─────────────────────────────────────────────────────────────
    describe('inspector — YAML preview', () => {
        it('is collapsed by default and expands to show the resource YAML on click', () => {
            const node = createMockNode({ kind: 'Deployment', name: 'web' });
            selectNode(node);
            const { container } = render(<Canvas />);

            expect(container.querySelector('.inspector-yaml-preview')).toBeNull();
            fireEvent.click(dom.getByText('YAML Preview'));
            expect(container.querySelector('.inspector-yaml-preview')).toBeInTheDocument();
            expect(dom.getByText(/kind: Deployment/)).toBeInTheDocument();
        });
    });

    // ── Delete ───────────────────────────────────────────────────────────────────
    describe('inspector — delete', () => {
        it('deletes the selected (non-managed) node via deleteNodeFromCanvas', () => {
            const deleteNodeFromCanvas = vi.fn();
            const node = createMockNode({ kind: 'Pod', name: 'p1' });
            selectNode(node, { deleteNodeFromCanvas });
            render(<Canvas />);

            fireEvent.click(dom.getByText('Delete Resource'));

            expect(deleteNodeFromCanvas).toHaveBeenCalledWith(node.id);
        });

        it('warns about cascading deletes only when the node owns children', () => {
            const dep = createMockNode({ kind: 'Deployment', name: 'web' });
            const child = createMockNode({ kind: 'ReplicaSet', name: 'web-abcde' }, { parentId: dep.id });
            selectNode(dep, { nodes: [dep, child] });
            render(<Canvas />);

            expect(dom.getByText('Owned resources are deleted with it (K8s cascade).')).toBeInTheDocument();
        });

        it('shows no cascade hint for a childless node', () => {
            selectNode(createMockNode({ kind: 'Pod', name: 'lonely' }));
            render(<Canvas />);
            expect(dom.queryByText(/deleted with it/)).toBeNull();
        });
    });

    // ── Toast notices ────────────────────────────────────────────────────────────
    describe('feedback toast', () => {
        it('renders the current notice text with a status role', () => {
            setMockStoreState({ notice: { id: 1, tone: 'success', text: 'Linked web to web-svc' } });
            render(<Canvas />);
            expect(dom.getByRole('status')).toHaveTextContent('Linked web to web-svc');
        });

        it('auto-dismisses a success/info toast after ~4.2s', () => {
            clock.install();
            const setNotice = vi.fn();
            setMockStoreState({ setNotice, notice: { id: 1, tone: 'success', text: 'Linked' } });
            render(<Canvas />);

            clock.tick(4200);

            expect(setNotice).toHaveBeenCalledWith(null);
            clock.uninstall();
        });

        it('gives error toasts a longer ~6s lifetime before dismissing', () => {
            clock.install();
            const setNotice = vi.fn();
            setMockStoreState({ setNotice, notice: { id: 1, tone: 'error', text: 'Invalid link' } });
            render(<Canvas />);

            clock.tick(4200);
            expect(setNotice).not.toHaveBeenCalled();

            clock.tick(1800); // 4200 + 1800 = 6000ms total
            expect(setNotice).toHaveBeenCalledWith(null);
            clock.uninstall();
        });
    });
});
