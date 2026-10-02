import { applyEdgeChanges, type Connection, type EdgeChange } from '@xyflow/react';
import {
    cronParallelismOf,
    isSingleNodeAccessMode,
    parallelismOf,
    replicasOf,
    type K8sNodeData,
} from '../../utils/buildGraph';
import {
    connectResources,
    explainInvalidLink,
    linkConfigMapToWorkload,
    linkIngressToSecret,
    linkPvcToWorkload,
    linkSecretToWorkload,
    type ConfigMapMechanism,
    type SecretMechanism,
} from '../../utils/linkResources';
import type { Node } from '@xyflow/react';
import {
    commitResources,
    collectWithDescendants,
    isAncestor,
    mergeEdges,
    toResources,
} from '../graphCommit';
import { persistUserEdges } from '../persistence';
import { makeNotice, type StoreSetter, type VeltraState } from '../types';

export function createLinkActions(
    set: StoreSetter
): Pick<
    VeltraState,
    | 'addCanvasEdge'
    | 'applyCanvasEdgeChanges'
    | 'setPendingConfigMapLink'
    | 'confirmConfigMapLink'
    | 'cancelConfigMapLink'
    | 'setPendingPvcLink'
    | 'confirmPvcLink'
    | 'cancelPvcLink'
    | 'setPendingSecretLink'
    | 'confirmSecretLink'
    | 'cancelSecretLink'
    | 'setPendingIngressTlsLink'
    | 'confirmIngressTlsLink'
    | 'cancelIngressTlsLink'
> {
    return {
        addCanvasEdge: (connection: Connection) =>
            set((state) => {
                const { source, target } = connection;
                if (!source || !target || source === target) return {};

                // Connections to controller-managed resources are redirected to their real
                // owner; linking a Service to a materialized Pod means "select this
                // workload's pods", which lives on the workload's spec.
                const realNodes = state.nodes.filter((n) => !n.data.synthetic);
                const resolveReal = (id: string): Node<K8sNodeData> | null => {
                    const node = state.nodes.find((n) => n.id === id);
                    if (!node) return null;
                    if (!node.data.synthetic) return node;
                    const owner = node.data.managedBy;
                    if (!owner) return null;
                    return (
                        realNodes.find(
                            (n) => n.data.kind === owner.kind && n.data.name === owner.name
                        ) ?? null
                    );
                };

                const sourceNode = resolveReal(source);
                const targetNode = resolveReal(target);
                if (!sourceNode || !targetNode) return {};
                if (sourceNode.id === targetNode.id) {
                    return {
                        notice: makeNotice('info', 'Those resources already belong to the same workload.'),
                    };
                }

                // Already related? Check edges between the two resources *including* their
                // managed descendants (a Service selecting a Deployment's pods draws its
                // edges to the pod nodes), and existing containment.
                const sourceTree = collectWithDescendants(state.nodes, sourceNode.id);
                const targetTree = collectWithDescendants(state.nodes, targetNode.id);
                const alreadyLinked = state.edges.some(
                    (e) =>
                        (sourceTree.has(e.source) && targetTree.has(e.target)) ||
                        (targetTree.has(e.source) && sourceTree.has(e.target))
                );
                if (alreadyLinked) {
                    return {
                        notice: makeNotice(
                            'info',
                            `${sourceNode.data.name} and ${targetNode.data.name} are already connected.`
                        ),
                    };
                }
                if (
                    isAncestor(state.nodes, sourceNode.id, targetNode.id) ||
                    isAncestor(state.nodes, targetNode.id, sourceNode.id)
                ) {
                    return {
                        notice: makeNotice('info', 'That ownership already exists: it is shown as nesting.'),
                    };
                }

                // ConfigMap ↔ workload/Pod: a valid semantic link, but the user must pick
                // the consumption mechanism (envFrom / volumes / env-key) first; surface
                // the post-drag prompt instead of committing immediately. `sourceNode`/
                // `targetNode` are real (synthetic targets were redirected to their owner).
                const isConfigMapTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'ConfigMap' && isConfigMapTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'ConfigMap' && isConfigMapTarget(sourceNode.data.kind))
                ) {
                    const cm = sourceNode.data.kind === 'ConfigMap' ? sourceNode : targetNode;
                    const workload = sourceNode.data.kind === 'ConfigMap' ? targetNode : sourceNode;
                    return {
                        pendingConfigMapLink: {
                            cm: { name: cm.data.name },
                            target: {
                                kind: workload.data.kind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: workload.data.name,
                            },
                        },
                    };
                }

                // PVC ↔ Pod/Deployment/ReplicaSet: a valid semantic link, but the
                // volume name is picked in the post-drag prompt before committing.
                // Single-node claims (ReadWriteOnce/ReadWriteOncePod) cannot serve a
                // workload that runs more than one replica: reject those up front.
                const isPvcMountTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'PersistentVolumeClaim' && isPvcMountTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'PersistentVolumeClaim' && isPvcMountTarget(sourceNode.data.kind))
                ) {
                    const pvc = sourceNode.data.kind === 'PersistentVolumeClaim' ? sourceNode : targetNode;
                    const mountTarget = sourceNode.data.kind === 'PersistentVolumeClaim' ? targetNode : sourceNode;
                    const multiPod = mountTarget.data.kind === 'Job'
                        ? parallelismOf(mountTarget.data.resource) > 1
                        : mountTarget.data.kind === 'CronJob'
                        ? cronParallelismOf(mountTarget.data.resource) > 1
                        : mountTarget.data.kind !== 'Pod' && replicasOf(mountTarget.data.resource) > 1;
                    if (multiPod && isSingleNodeAccessMode(pvc.data.resource)) {
                        return {
                            notice: makeNotice(
                                'error',
                                mountTarget.data.kind === 'Job'
                                    ? `Job ${mountTarget.data.name} runs ${parallelismOf(mountTarget.data.resource)} pods in parallel; a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Reduce parallelism to 1 or use ReadWriteMany/ReadOnlyMany.`
                                    : mountTarget.data.kind === 'CronJob'
                                    ? `CronJob ${mountTarget.data.name} runs ${cronParallelismOf(mountTarget.data.resource)} pods in parallel; a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Reduce parallelism to 1 or use ReadWriteMany/ReadOnlyMany.`
                                    : `${mountTarget.data.kind} ${mountTarget.data.name} runs ${replicasOf(mountTarget.data.resource)} replicas; a ReadWriteOnce/ReadWriteOncePod PVC can only attach to one node. Scale down to 1 or use ReadWriteMany/ReadOnlyMany.`
                            ),
                        };
                    }
                    return {
                        pendingPvcLink: {
                            pvc: { name: pvc.data.name },
                            target: {
                                kind: mountTarget.data.kind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: mountTarget.data.name,
                            },
                        },
                    };
                }

                // Secret ↔ workload/Pod: a valid semantic link, but the user must pick
                // the consumption mechanism (envFrom / volumes / env-key) first;
                // surface the post-drag prompt instead of committing immediately.
                const isSecretTarget = (kind: string) =>
                    kind === 'Pod' || kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'Job' || kind === 'CronJob';
                if (
                    (sourceNode.data.kind === 'Secret' && isSecretTarget(targetNode.data.kind)) ||
                    (targetNode.data.kind === 'Secret' && isSecretTarget(sourceNode.data.kind))
                ) {
                    const secret = sourceNode.data.kind === 'Secret' ? sourceNode : targetNode;
                    const workload = sourceNode.data.kind === 'Secret' ? targetNode : sourceNode;
                    return {
                        pendingSecretLink: {
                            secret: { name: secret.data.name },
                            target: {
                                kind: workload.data.kind as 'Pod' | 'Deployment' | 'ReplicaSet' | 'Job' | 'CronJob',
                                name: workload.data.name,
                            },
                        },
                    };
                }

                // Ingress ↔ Secret: a valid TLS link, but the user picks the hosts in
                // the post-drag prompt before committing.
                if (
                    (sourceNode.data.kind === 'Ingress' && targetNode.data.kind === 'Secret') ||
                    (targetNode.data.kind === 'Ingress' && sourceNode.data.kind === 'Secret')
                ) {
                    const ingress = sourceNode.data.kind === 'Ingress' ? sourceNode : targetNode;
                    const secret = sourceNode.data.kind === 'Secret' ? sourceNode : targetNode;
                    return {
                        pendingIngressTlsLink: {
                            ingress: { name: ingress.data.name },
                            secret: { name: secret.data.name },
                        },
                    };
                }

                // Express the link semantically in the K8s model (selector/labels/backend).
                // toResources drops synthetic nodes, so indices align with realNodes.
                const resources = toResources(state.nodes);
                const linked = connectResources(
                    resources,
                    realNodes.indexOf(sourceNode),
                    realNodes.indexOf(targetNode)
                );
                if (!linked) {
                    return {
                        notice: makeNotice(
                            'error',
                            explainInvalidLink(sourceNode.data.kind, targetNode.data.kind)
                        ),
                    };
                }
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    notice: makeNotice('success', linked.description),
                };
            }),

        applyCanvasEdgeChanges: (changes: EdgeChange[]) =>
            set((state) => {
                // Removal only applies to manual edges; selection applies to both sets
                const userEdges = applyEdgeChanges(changes, state.userEdges);
                const selectChanges = changes.filter((c) => c.type === 'select');
                const inferredEdges = selectChanges.length
                    ? applyEdgeChanges(selectChanges, state.inferredEdges)
                    : state.inferredEdges;
                persistUserEdges(userEdges);
                return {
                    userEdges,
                    inferredEdges,
                    edges: mergeEdges(inferredEdges, userEdges, state.nodes),
                };
            }),

        setPendingConfigMapLink: (link) => set({ pendingConfigMapLink: link }),

        cancelConfigMapLink: () => set({ pendingConfigMapLink: null }),

        confirmConfigMapLink: (mechanism: ConfigMapMechanism, key?: string) =>
            set((state) => {
                const pending = state.pendingConfigMapLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const cmIdx = resources.findIndex(
                    (r) => r.kind === 'ConfigMap' && r.metadata.name === pending.cm.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (cmIdx < 0 || targetIdx < 0) {
                    return { pendingConfigMapLink: null };
                }
                const linked = linkConfigMapToWorkload(resources, cmIdx, targetIdx, mechanism, key);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingConfigMapLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingPvcLink: (link) => set({ pendingPvcLink: link }),

        cancelPvcLink: () => set({ pendingPvcLink: null }),

        confirmPvcLink: (volumeName: string) =>
            set((state) => {
                const pending = state.pendingPvcLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const pvcIdx = resources.findIndex(
                    (r) => r.kind === 'PersistentVolumeClaim' && r.metadata.name === pending.pvc.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (pvcIdx < 0 || targetIdx < 0) {
                    return { pendingPvcLink: null };
                }
                const linked = linkPvcToWorkload(resources, pvcIdx, targetIdx, volumeName);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingPvcLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingSecretLink: (link) => set({ pendingSecretLink: link }),

        cancelSecretLink: () => set({ pendingSecretLink: null }),

        confirmSecretLink: (mechanism: SecretMechanism, key?: string, volumeName?: string) =>
            set((state) => {
                const pending = state.pendingSecretLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const secretIdx = resources.findIndex(
                    (r) => r.kind === 'Secret' && r.metadata.name === pending.secret.name
                );
                const targetIdx = resources.findIndex(
                    (r) =>
                        r.kind === pending.target.kind && r.metadata.name === pending.target.name
                );
                if (secretIdx < 0 || targetIdx < 0) {
                    return { pendingSecretLink: null };
                }
                const linked = linkSecretToWorkload(
                    resources,
                    secretIdx,
                    targetIdx,
                    mechanism,
                    key,
                    volumeName
                );
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingSecretLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),

        setPendingIngressTlsLink: (link) => set({ pendingIngressTlsLink: link }),

        cancelIngressTlsLink: () => set({ pendingIngressTlsLink: null }),

        confirmIngressTlsLink: (hosts: string[]) =>
            set((state) => {
                const pending = state.pendingIngressTlsLink;
                if (!pending) return {};
                const resources = toResources(state.nodes);
                const ingressIdx = resources.findIndex(
                    (r) => r.kind === 'Ingress' && r.metadata.name === pending.ingress.name
                );
                const secretIdx = resources.findIndex(
                    (r) => r.kind === 'Secret' && r.metadata.name === pending.secret.name
                );
                if (ingressIdx < 0 || secretIdx < 0) {
                    return { pendingIngressTlsLink: null };
                }
                const linked = linkIngressToSecret(resources, ingressIdx, secretIdx, hosts);
                return {
                    ...commitResources(state, linked.resources, state.nodes),
                    pendingIngressTlsLink: null,
                    notice: makeNotice('success', linked.description),
                };
            }),
    };
}
