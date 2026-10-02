import { type Edge, type Node } from '@xyflow/react';
import { applyHpaReplicaOverrides, type HpaReplicaOverride, type K8sNodeData } from '../utils/buildGraph';
import { parseYaml } from '../utils/parseYaml';
import { resourcesToYaml } from '../utils/serializeYaml';
import { computeFileOf, fileViewOf } from '../utils/fileTree';
import type { NsLayout } from '../utils/teachingFrame';
import { ACTIVE_FILE_KEY, DEFAULT_YAML, FILE_EXPLORER_KEY, YAML_KEY } from './constants';
import { readNsLayout, readUserEdges } from './persistence';
import { deriveGraph, toResources } from './graphCommit';
import type { VeltraStateFields } from './types';

/**
 * Initial load: read the persisted YAML, manual edges and namespace layout,
 * clamp HorizontalPodAutoscaler targets, derive the first graph and restore
 * the file-explorer view. An unparseable saved YAML yields an empty canvas
 * plus the error (never a graph that disagrees with the visible text).
 */
export function computeInitialState(): VeltraStateFields {
    const savedYaml = localStorage.getItem(YAML_KEY);
    let yamlVal = savedYaml !== null ? savedYaml : DEFAULT_YAML;
    const userEdgesVal = readUserEdges();

    let initialGraph: {
        nodes: Node<K8sNodeData>[];
        inferredEdges: Edge[];
        edges: Edge[];
        nsLayout?: NsLayout | null;
    } = {
        nodes: [],
        inferredEdges: [],
        edges: [],
        nsLayout: undefined,
    };
    let initialHpaOverrides: HpaReplicaOverride[] = [];
    let initialError: string | null = null;

    // Persisted namespace layout, or null (derive from the live graph until the
    // user actually edits rectangles).
    const savedNsLayout = readNsLayout();

    try {
        const resources = parseYaml(yamlVal);
        // HorizontalPodAutoscaler priority also corrects pasted/saved YAML on load: the clamped value
        // is written back into the model AND the editor so nothing disagrees.
        const overrides = applyHpaReplicaOverrides(resources);
        if (overrides.length) {
            const nextYaml = resourcesToYaml(resources);
            localStorage.setItem(YAML_KEY, nextYaml);
            yamlVal = nextYaml;
            initialHpaOverrides = overrides;
        }
        initialGraph = deriveGraph(resources, [], userEdgesVal, savedNsLayout);
        initialGraph.nsLayout = initialGraph.nsLayout ?? savedNsLayout;
    } catch (e: any) {
        // Keep the editor content (with error surfaced) and an empty canvas;
        // never render a graph that doesn't correspond to the visible YAML.
        initialError = e.message || String(e);
    }

    // File-explorer mode is persisted; the active file is re-validated against the
    // restored manifest (falling back to the first virtual file when it's gone).
    const savedFileExplorerMode = localStorage.getItem(FILE_EXPLORER_KEY) === '1';
    const savedActiveFile = localStorage.getItem(ACTIVE_FILE_KEY);
    let initialFileView = { activeFile: null as string | null, activeFileText: '' };
    if (savedFileExplorerMode) {
        const bootResources = toResources(initialGraph.nodes);
        const bootFileOf = computeFileOf(bootResources);
        let path = savedActiveFile && new Set(bootFileOf.values()).has(savedActiveFile)
            ? savedActiveFile
            : null;
        if (path === null) path = bootFileOf.values().next().value ?? null;
        initialFileView = fileViewOf(bootResources, path);
    }

    return {
        yaml: yamlVal,
        nodes: initialGraph.nodes,
        inferredEdges: initialGraph.inferredEdges,
        edges: initialGraph.edges,
        userEdges: userEdgesVal,
        selectedResource: null,
        yamlError: initialError,
        notice: null,
        hpaOverrides: initialHpaOverrides,
        pendingConfigMapLink: null,
        pendingPvcLink: null,
        pendingSecretLink: null,
        pendingIngressTlsLink: null,
        nsEditMode: false,
        nsLayout: initialGraph.nsLayout ?? savedNsLayout,
        fileExplorerMode: savedFileExplorerMode,
        activeFile: initialFileView.activeFile,
        activeFileText: initialFileView.activeFileText,
        fileYamlError: null,
    };
}
