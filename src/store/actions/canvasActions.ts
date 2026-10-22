import { type Node } from '@xyflow/react';
import {
    applyHpaReplicaOverrides,
    collectGatewayApiFamily,
    isGatewayApiKind,
    nodeIdFor,
    type K8sNodeData,
} from '../../utils/buildGraph';
import { isClusterScoped } from '../../utils/k8sScope';
import { parseYaml } from '../../utils/parseYaml';
import { resourcesToYaml } from '../../utils/serializeYaml';
import { fileViewOf } from '../../utils/fileTree';
import type { K8sResource, SupportedKind } from '../../types/types';
import { YAML_KEY } from '../constants';
import { clearSavedPositions, mergePositionsIntoStorage, persistNsLayout, renameStoredPosition, persistUserEdges } from '../persistence';
import {
    apiVersionForKind,
    commitResources,
    collectWithDescendants,
    deriveGraph,
    managedGuardNotice,
    toResources,
} from '../graphCommit';
import {
    renameConfigMapReferences,
    renameGatewayClassReferences,
    renameGatewayReferences,
    renamePvcReferences,
    renamePvReferences,
    renameRouteBackendReferences,
    renameSecretReferences,
    renameServiceReferences,
    renameStorageClassReferences,
    renameVpaTargetReferences,
    renameWorkloadReferences,
} from '../renames';
import { makeNotice, type CanvasNotice, type StoreGetter, type StoreSetter, type KubeSketchState } from '../types';

export function createCanvasActions(
    set: StoreSetter,
    get: StoreGetter
): Pick<
    KubeSketchState,
    | 'setNotice'
    | 'setYaml'
    | 'setCanvasNodes'
    | 'setCanvasNodesPositionOnly'
    | 'persistNodePositions'
    | 'updateNodeFromCanvas'
    | 'updateNodeResourceFromCanvas'
    | 'deleteNodeFromCanvas'
    | 'setSelectedResource'
> {
    return {
        setNotice: (notice: CanvasNotice | null) => set({ notice }),

        setYaml: (value: string) => {
            try {
                const resources = parseYaml(value);
                // HorizontalPodAutoscaler priority: clamp + write back the corrected YAML to the editor
                // (a targeted workload's replicas can never stay below minReplicas).
                const hpaOverrides = applyHpaReplicaOverrides(resources);
                const nextYaml = hpaOverrides.length ? resourcesToYaml(resources) : value;
                if (hpaOverrides.length) {
                    localStorage.setItem(YAML_KEY, nextYaml);
                }
                const state = get();
                // Fresh placement for resources added through the editor: a stale
                // pinned position from a previously deleted resource with the same
                // kind+name would bypass the lane layout AND the placement repair.
                const liveKeys = new Set(state.nodes.map((n) => `${n.data.kind}:${n.data.name}`));
                clearSavedPositions(
                    resources
                        .map((r) => `${r.kind}:${r.metadata?.name}`)
                        .filter((key) => !liveKeys.has(key))
                );
                const derivedResult = deriveGraph(resources, state.nodes, state.userEdges, state.nsLayout);
                const { layoutChanged, ...derived } = derivedResult;
                if (layoutChanged && derived.nsLayout) {
                    persistNsLayout(derived.nsLayout);
                }
                const sel = state.selectedResource;
                const selectionStillExists =
                    sel && derived.nodes.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);
                set({
                    yaml: nextYaml,
                    ...derived,
                    yamlError: null,
                    selectedResource: selectionStillExists ? sel : null,
                    hpaOverrides,
                    // Load Sample / YAML imports can change the tree while file mode
                    // is on; re-validate the active file against the new manifest.
                    ...(state.fileExplorerMode ? fileViewOf(resources, state.activeFile) : {}),
                });
            } catch (err: any) {
                // Graceful error: update raw text and store the error, but do NOT wipe/flicker the graph
                set({ yaml: value, yamlError: err.message || String(err) });
            }
        },

        setCanvasNodes: (nodes: Node<K8sNodeData>[]) =>
            set((state) => {
                const removed = state.nodes.filter((n) => !nodes.some((m) => m.id === n.id));
                const removedIds = new Set(removed.map((n) => n.id));
                // Real deleted resources leave no position pin behind (synthetic
                // ones keep theirs; the rebuild re-materializes them in place).
                clearSavedPositions(
                    removed
                        .filter((n) => !n.data.synthetic)
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );
                const userEdges = removedIds.size
                    ? state.userEdges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target))
                    : state.userEdges;
                const sel = state.selectedResource;
                const selectionRemoved =
                    sel && !nodes.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);
                const result = commitResources(state, toResources(nodes), nodes, {
                    userEdges,
                    selectedResource: selectionRemoved ? null : sel,
                });
                // Deleting a controller-managed resource behaves like a real cluster:
                // the commit re-materializes it from the owner's spec.
                const managed = removed.find((n) => n.data.synthetic);
                if (managed?.data.managedBy) {
                    result.notice = makeNotice(
                        'info',
                        `${managed.data.name} is managed by ${managed.data.managedBy.kind} ${managed.data.managedBy.name}: the controller recreated it. Delete the owner or lower its replicas instead.`
                    );
                }
                return result;
            }),

        setCanvasNodesPositionOnly: (nodes: Node<K8sNodeData>[]) => set({ nodes }),

        persistNodePositions: (draggedIds: string[]) => {
            const state = get();
            const dragged = state.nodes.filter((n) => !n.parentId && draggedIds.includes(n.id));
            mergePositionsIntoStorage(
                dragged.map((n) => ({
                    key: `${n.data.kind}:${n.data.name}`,
                    value: n.position,
                }))
            );
        },

        updateNodeFromCanvas: (nodeId, patch) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (!node) return {};
                if (node.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }

                const kind = (patch.kind ?? node.data.kind) as SupportedKind;
                const name = (patch.name ?? node.data.name).trim();
                // Cluster-scoped kinds (PV/StorageClass) can never hold a namespace.
                const namespace = isClusterScoped(kind)
                    ? undefined
                    : patch.namespace !== undefined
                    ? patch.namespace
                    : node.data.namespace;

                if (!name) return {}; // never allow a nameless resource
                const duplicate = state.nodes.some(
                    (n) =>
                        n.id !== nodeId &&
                        n.data.kind === kind &&
                        n.data.name === name
                );
                if (duplicate) return {}; // caller (inspector/modal) surfaces the error

                let updatedNodes = state.nodes.map((n) => {
                    if (n.id !== nodeId) return n;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            kind,
                            name,
                            namespace: namespace || undefined,
                            resource: {
                                ...n.data.resource,
                                apiVersion: apiVersionForKind(kind),
                                kind,
                                metadata: {
                                    ...(n.data.resource.metadata ?? {}),
                                    name,
                                    ...(namespace ? { namespace } : { namespace: undefined }),
                                },
                            },
                        },
                    };
                });

                // Cascade rename into name-based references: Ingress backends point at
                // Services by name, HorizontalPodAutoscaler scaleTargetRefs at Deployments/ReplicaSets by
                // name (label selectors are unaffected by renames)
                if (node.data.kind === 'Service' && kind === 'Service' && name !== node.data.name) {
                    updatedNodes = renameServiceReferences(updatedNodes, node.data.name, name);
                    updatedNodes = renameRouteBackendReferences(updatedNodes, node.data.name, name);
                }
                if (
                    (node.data.kind === 'Deployment' || node.data.kind === 'ReplicaSet') &&
                    kind === node.data.kind &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameWorkloadReferences(
                        updatedNodes,
                        node.data.kind as 'Deployment' | 'ReplicaSet',
                        node.data.name,
                        name
                    );
                    updatedNodes = renameVpaTargetReferences(
                        updatedNodes,
                        node.data.kind as 'Deployment' | 'ReplicaSet',
                        node.data.name,
                        name
                    );
                }
                if (node.data.kind === 'Pod' && kind === 'Pod' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'Pod', node.data.name, name);
                }
                if (node.data.kind === 'Job' && kind === 'Job' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'Job', node.data.name, name);
                }
                if (node.data.kind === 'CronJob' && kind === 'CronJob' && name !== node.data.name) {
                    updatedNodes = renameVpaTargetReferences(updatedNodes, 'CronJob', node.data.name, name);
                }
                if (node.data.kind === 'ConfigMap' && kind === 'ConfigMap' && name !== node.data.name) {
                    updatedNodes = renameConfigMapReferences(updatedNodes, node.data.name, name);
                }
                if (node.data.kind === 'Secret' && kind === 'Secret' && name !== node.data.name) {
                    updatedNodes = renameSecretReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'PersistentVolumeClaim' &&
                    kind === 'PersistentVolumeClaim' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renamePvcReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'PersistentVolume' &&
                    kind === 'PersistentVolume' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renamePvReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'StorageClass' &&
                    kind === 'StorageClass' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameStorageClassReferences(updatedNodes, node.data.name, name);
                }
                if (
                    node.data.kind === 'GatewayClass' &&
                    kind === 'GatewayClass' &&
                    name !== node.data.name
                ) {
                    updatedNodes = renameGatewayClassReferences(updatedNodes, node.data.name, name);
                }
                if (node.data.kind === 'Gateway' && kind === 'Gateway' && name !== node.data.name) {
                    updatedNodes = renameGatewayReferences(updatedNodes, node.data.name, name);
                }

                // Identity may have changed (kind/name are part of the node ID):
                // remap manual edges, migrate the saved position, and follow the selection.
                const newId = nodeIdFor(kind, name);
                let userEdges = state.userEdges;
                if (newId !== nodeId) {
                    userEdges = state.userEdges.map((e) => ({
                        ...e,
                        source: e.source === nodeId ? newId : e.source,
                        target: e.target === nodeId ? newId : e.target,
                    }));
                    persistUserEdges(userEdges);
                    renameStoredPosition(
                        `${node.data.kind}:${node.data.name}`,
                        `${kind}:${name}`
                    );
                }

                const sel = state.selectedResource;
                const wasSelected = sel && sel.kind === node.data.kind && sel.name === node.data.name;
                // A pure namespace change (same kind+name, different namespace) is
                // a reassignment: the placement engine re-positions the node inside
                // the target namespace: fresh, overlap-free, growing the box when
                // the resource doesn't fit. Its saved position is cleared and its
                // old position is not inherited (it never belonged to this box).
                const isNsReassignment =
                    kind === node.data.kind &&
                    name === node.data.name &&
                    !isClusterScoped(kind) &&
                    namespace !== undefined &&
                    namespace !== (node.data.namespace ?? 'default');
                const prevNodes = isNsReassignment
                    ? updatedNodes.filter((n) => n.id !== nodeId)
                    : updatedNodes;
                if (isNsReassignment) {
                    clearSavedPositions([`${kind}:${name}`]);
                }
                return commitResources(state, toResources(updatedNodes), prevNodes, {
                    userEdges,
                    selectedResource: wasSelected ? { kind, name } : sel,
                });
            }),

        updateNodeResourceFromCanvas: (nodeId, resource: K8sResource) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (!node) return {};
                if (node.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }

                const kind = (resource.kind as SupportedKind) ?? node.data.kind;
                const name = resource.metadata?.name ?? node.data.name;

                const updatedNodes = state.nodes.map((n) => {
                    if (n.id !== nodeId) return n;
                    return {
                        ...n,
                        data: {
                            ...n.data,
                            resource,
                            kind,
                            name,
                            namespace: resource.metadata?.namespace,
                        },
                    };
                });

                const newId = nodeIdFor(kind, name);
                let userEdges = state.userEdges;
                if (newId !== nodeId) {
                    userEdges = state.userEdges.map((e) => ({
                        ...e,
                        source: e.source === nodeId ? newId : e.source,
                        target: e.target === nodeId ? newId : e.target,
                    }));
                    persistUserEdges(userEdges);
                    renameStoredPosition(`${node.data.kind}:${node.data.name}`, `${kind}:${name}`);
                }

                const sel = state.selectedResource;
                const wasSelected = sel && sel.kind === node.data.kind && sel.name === node.data.name;
                return commitResources(state, toResources(updatedNodes), updatedNodes, {
                    userEdges,
                    selectedResource: wasSelected ? { kind, name } : sel,
                });
            }),

        deleteNodeFromCanvas: (nodeId) =>
            set((state) => {
                const node = state.nodes.find((n) => n.id === nodeId);
                if (node?.data.synthetic) {
                    return { notice: managedGuardNotice(node) };
                }
                // Cascade like Kubernetes: deleting a controller removes what it owns.
                const doomed = collectWithDescendants(state.nodes, nodeId);
                // Gateway API is one family: deleting any GatewayClass/Gateway/Route
                // removes the whole linked cluster (class → gateways → routes), but
                // never the Services its Routes route to (backendRefs are not ownership).
                if (node && isGatewayApiKind(node.data.kind)) {
                    collectGatewayApiFamily(state.nodes, nodeId).forEach((id) => doomed.add(id));
                }
                if (doomed.size === 0) return {};
                // Deleted resources leave no trace in the position store; a future
                // re-create with the same kind+name must get fresh placement.
                clearSavedPositions(
                    state.nodes
                        .filter((n) => doomed.has(n.id))
                        .map((n) => `${n.data.kind}:${n.data.name}`)
                );

                const remaining = state.nodes.filter((n) => !doomed.has(n.id));
                const userEdges = state.userEdges.filter(
                    (e) => !doomed.has(e.source) && !doomed.has(e.target)
                );

                const sel = state.selectedResource;
                const selectionRemoved =
                    sel && !remaining.some((n) => n.data.kind === sel.kind && n.data.name === sel.name);

                return commitResources(state, toResources(remaining), remaining, {
                    userEdges,
                    selectedResource: selectionRemoved ? null : sel,
                });
            }),

        setSelectedResource: (resource) => set({ selectedResource: resource }),
    };
}
