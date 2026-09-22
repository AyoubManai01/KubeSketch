/**
 * Shared fixtures and collaborator mocks for the Canvas / CreateResourceModal /
 * K8sNode / YamlEditor spec files.
 *
 * `vi.mock(path, factory)` calls must be written directly in each spec file
 * (Vitest statically hoists them above imports) — this module only supplies
 * the fixtures and the factory functions passed as their second argument.
 */
import React from 'react';
import { vi, type Mock } from 'vitest';
import type { Node, Edge, NodeChange } from '@xyflow/react';
import type { K8sNodeData } from '../../utils/buildGraph';
import type { K8sResource, SupportedKind } from '../../types/types';
import type { NsLayout } from '../../utils/teachingFrame';

// Deliberately NOT importing the real `nodeIdFor` from '../../utils/buildGraph':
// that module also imports the real '@xyflow/react' (for MarkerType), and since
// this file backs the `@xyflow/react` mock factory, that creates a circular
// re-entry into the very module being mocked. Harmless on its own, but combined
// with a second `vi.mock(...)` registered in the same spec file (e.g. the store)
// it reliably deadlocks Vitest's mock resolution. `nodeIdFor` is a one-line
// format, so a local copy is a fine, low-risk way to avoid the whole chain.
function nodeIdFor(kind: string, name: string): string {
    return `${kind}-${name}`;
}

// ─── Resource / node fixtures ────────────────────────────────────────────────

function apiVersionFor(kind: SupportedKind): string {
    if (kind === 'Deployment' || kind === 'ReplicaSet') return 'apps/v1';
    if (kind === 'Ingress') return 'networking.k8s.io/v1';
    return 'v1';
}

export function createMockResource(overrides: Partial<K8sResource> = {}): K8sResource {
    const kind = (overrides.kind ?? 'Deployment') as SupportedKind;
    return {
        apiVersion: apiVersionFor(kind),
        spec: {},
        ...overrides,
        kind,
        metadata: { name: 'demo', namespace: 'default', ...overrides.metadata },
    };
}

/**
 * Build a React Flow node carrying K8sNodeData. `dataOverrides` covers the
 * common case (kind/name/synthetic/managedBy/resource); `nodeOverrides` lets a
 * test override position/parentId/style directly when it matters (e.g. nesting).
 */
export function createMockNode(
    dataOverrides: Partial<K8sNodeData> = {},
    nodeOverrides: Partial<Node<K8sNodeData>> = {}
): Node<K8sNodeData> {
    const kind = dataOverrides.kind ?? 'Deployment';
    const name = dataOverrides.name ?? 'demo';
    const data: K8sNodeData = {
        namespace: 'default',
        resource: createMockResource({ kind, metadata: { name, namespace: 'default' } }),
        ...dataOverrides,
        kind,
        name,
    };
    return {
        id: nodeIdFor(kind, name),
        type: 'k8sNode',
        position: { x: 0, y: 0 },
        style: { width: 220, height: 130 },
        data,
        ...nodeOverrides,
    };
}

export function createMockEdge(overrides: Partial<Edge> = {}): Edge {
    return {
        id: overrides.id ?? `${overrides.source}->${overrides.target}`,
        source: '',
        target: '',
        ...overrides,
    } as Edge;
}

// ─── Zustand store mock ───────────────────────────────────────────────────────

/** The slice of VeltraState that Canvas / CreateResourceModal / YamlEditor actually read. */
export interface MockStoreState {
    yaml: string;
    yamlError: string | null;
    nodes: Node<K8sNodeData>[];
    edges: Edge[];
    selectedResource: { kind: SupportedKind; name: string } | null;
    notice: { id: number; tone: 'success' | 'error' | 'info'; text: string } | null;
    hpaOverrides: { kind: string; name: string; original: number; effective: number; hpaName: string; reason: 'minReplicas' | 'maxReplicas'; bound: number; viaDeployment?: string }[];
    nsLayout: NsLayout | null;
    addNamespace: Mock;
    deleteNamespace: Mock;
    setNotice: Mock;
    setYaml: Mock;
    updateNodeFromCanvas: Mock;
    deleteNodeFromCanvas: Mock;
    setCanvasNodes: Mock;
    setCanvasNodesPositionOnly: Mock;
    persistNodePositions: Mock;
    setSelectedResource: Mock;
    addCanvasEdge: Mock;
    applyCanvasEdgeChanges: Mock;
    updateNodeResourceFromCanvas: Mock;
    addConfiguredNode: Mock;
    addConfiguredNodes: Mock;
    resetLayout: Mock;
    clearAll: Mock;
    nsEditMode: boolean;
    setNsEditMode: Mock;
}

export function createDefaultStoreState(): MockStoreState {
    return {
        yaml: '',
        yamlError: null,
        nodes: [],
        edges: [],
        selectedResource: null,
        notice: null,
        hpaOverrides: [],
        nsLayout: null,
        addNamespace: vi.fn(),
        deleteNamespace: vi.fn(),
        setNotice: vi.fn(),
        setYaml: vi.fn(),
        updateNodeFromCanvas: vi.fn(),
        deleteNodeFromCanvas: vi.fn(),
        setCanvasNodes: vi.fn(),
        setCanvasNodesPositionOnly: vi.fn(),
        persistNodePositions: vi.fn(),
        setSelectedResource: vi.fn(),
        addCanvasEdge: vi.fn(),
        applyCanvasEdgeChanges: vi.fn(),
        updateNodeResourceFromCanvas: vi.fn(),
        addConfiguredNode: vi.fn(),
        addConfiguredNodes: vi.fn(),
        resetLayout: vi.fn(),
        clearAll: vi.fn(),
        nsEditMode: false,
        setNsEditMode: vi.fn(),
    };
}

let mockState: MockStoreState = createDefaultStoreState();

/** Merge a partial state into the live mock store — call from a test's arrange step. */
export function setMockStoreState(partial: Partial<MockStoreState>): void {
    mockState = { ...mockState, ...partial };
}

/** Reset to defaults — call from `beforeEach` so tests never leak state into each other. */
export function resetMockStoreState(): void {
    mockState = createDefaultStoreState();
}

/** Factory passed to `vi.mock('../../store/store', storeMockFactory)`. */
export function storeMockFactory() {
    return {
        useVeltraStore: Object.assign(
            (selector: (s: MockStoreState) => unknown) => selector(mockState),
            { getState: () => mockState },
        ),
        DEFAULT_YAML: '',
        apiVersionForKind: (kind: SupportedKind): string => apiVersionFor(kind),
    };
}

// ─── @xyflow/react mock ───────────────────────────────────────────────────────

let capturedReactFlowProps: Record<string, any> | null = null;

/** Read the props Canvas last passed to <ReactFlow>, to drive its callbacks directly. */
export function getCapturedReactFlowProps(): Record<string, any> {
    if (!capturedReactFlowProps) {
        throw new Error('ReactFlow has not been rendered yet — call render(<Canvas />) first.');
    }
    return capturedReactFlowProps;
}

export function resetCapturedReactFlowProps(): void {
    capturedReactFlowProps = null;
}

/** Factory passed to `vi.mock('@xyflow/react', xyflowMockFactory)`. */
export function xyflowMockFactory() {
    return {
        ReactFlow: (props: Record<string, any>) => {
            capturedReactFlowProps = props;
            return React.createElement('div', { 'data-testid': 'react-flow-mock' }, props.children);
        },
        Handle: (props: { type: string; position: string; className?: string }) =>
            React.createElement('div', {
                'data-testid': `handle-${props.type}-${props.position}`,
                className: props.className,
            }),
        Position: { Top: 'top', Bottom: 'bottom' },
        Background: () => null,
        BackgroundVariant: { Dots: 'dots' },
        Controls: () => React.createElement('div', { 'data-testid': 'controls-mock' }),
        Panel: (props: { children?: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'panel-mock' }, props.children),
        ViewportPortal: (props: { children?: React.ReactNode }) =>
            React.createElement('div', { 'data-testid': 'viewport-portal-mock' }, props.children),
        applyNodeChanges: (changes: unknown, nodes: unknown) => {
            const next = (nodes as Array<Record<string, unknown>>).map((n) => ({ ...n }));
            for (const c of changes as NodeChange[]) {
                if (c.type === 'position') {
                    for (const n of next) {
                        if (n.id === c.id) n.position = c.position;
                    }
                } else if (c.type === 'select') {
                    for (const n of next) {
                        if (n.id === c.id) n.selected = c.selected;
                    }
                } else if (c.type === 'dimensions') {
                    for (const n of next) {
                        if (n.id === c.id) n.style = { ...(n.style as object), ...c.dimensions };
                    }
                } else if (c.type === 'remove') {
                    return next.filter((n) => n.id !== c.id);
                }
            }
            return next;
        },
        applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
        MarkerType: { ArrowClosed: 'arrowclosed' },
        // NsFrame calls `useReactFlow().screenToFlowPosition` to map pointer
        // coordinates into flow space for its drag protocol; an identity
        // transform keeps frame tests deterministic.
        useReactFlow: () => ({
            screenToFlowPosition: (point: { x: number; y: number }) => point,
        }),
    };
}

// ─── @monaco-editor/react mock ─────────────────────────────────────────────────

export interface FakeMonacoEditor {
    deltaDecorations: Mock;
    revealLineInCenter: Mock;
}
export interface FakeMonacoNamespace {
    Range: Mock;
}

let fakeEditor: FakeMonacoEditor;
let fakeMonaco: FakeMonacoNamespace;

/** Call from `beforeEach` alongside `resetMockStoreState()` when testing YamlEditor. */
export function resetFakeMonaco(): void {
    fakeEditor = {
        deltaDecorations: vi.fn((_old: string[], decorations: unknown[]) =>
            decorations.map((_, i) => `dec-${i}`)
        ),
        revealLineInCenter: vi.fn(),
    };
    fakeMonaco = {
        // A plain function, not an arrow function: YamlEditor.tsx calls `new
        // monaco.Range(...)`, and arrow functions can never be used as a
        // constructor (throws "is not a constructor") — mocking it as one
        // would silently misrepresent the real monaco.Range API.
        Range: vi.fn(function (startLine: number, startCol: number, endLine: number, endCol: number) {
            return { startLine, startCol, endLine, endCol };
        }),
    };
}
resetFakeMonaco();

export function getFakeMonacoEditor(): FakeMonacoEditor {
    return fakeEditor;
}
export function getFakeMonacoNamespace(): FakeMonacoNamespace {
    return fakeMonaco;
}

/** Factory passed to `vi.mock('@monaco-editor/react', monacoMockFactory)`. */
export function monacoMockFactory() {
    function MockEditor(props: {
        value: string;
        onChange?: (value: string) => void;
        onMount?: (editor: FakeMonacoEditor, monaco: FakeMonacoNamespace) => void;
    }) {
        React.useEffect(() => {
            props.onMount?.(fakeEditor, fakeMonaco);
            // Runs once per mount, mirroring Monaco's real onMount contract.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return React.createElement('textarea', {
            'data-testid': 'monaco-editor-mock',
            value: props.value,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => props.onChange?.(e.target.value),
        });
    }
    return { __esModule: true, default: MockEditor };
}

// ─── CreateResourceModal mock (for Canvas tests) ───────────────────────────────

/** Factory passed to `vi.mock('../CreateResourceModal', createResourceModalMockFactory)`. */
export function createResourceModalMockFactory() {
    return {
        __esModule: true,
        default: (props: { kind: string; onClose: () => void }) =>
            React.createElement(
                'div',
                { 'data-testid': 'create-modal-mock', 'data-kind': props.kind },
                React.createElement('button', { onClick: props.onClose }, 'close-modal')
            ),
    };
}

// ─── Fake timers (for the canvas toast auto-dismiss tests) ────────────────────

export const clock = {
    // `shouldAdvanceTime` lets real time keep flowing for anything the fake
    // clock doesn't know about (notably React's own effect-flushing during
    // render/mount) — without it, calling render() while fake timers are
    // installed can hang indefinitely instead of just failing on a timeout.
    install: () => vi.useFakeTimers({ shouldAdvanceTime: true }),
    uninstall: () => vi.useRealTimers(),
    tick: (ms: number) => vi.advanceTimersByTime(ms),
};
