import { applyHpaReplicaOverrides } from '../../utils/buildGraph';
import { fileViewOf } from '../../utils/fileTree';
import {
    linkConfigMapToWorkload,
    linkPvcToWorkload,
    linkSecretToWorkload,
} from '../../utils/linkResources';
import type { K8sResource, SupportedKind } from '../../types/types';
import { POSITIONS_KEY, NS_LAYOUT_KEY, YAML_KEY } from '../constants';
import { clearSavedPositions, persistNsLayout } from '../persistence';
import { commitResources, deriveGraph, toResources } from '../graphCommit';
import type {
    ConfigMapLinkPayload,
    IngressTlsPayload,
    PvcLinkPayload,
    SecretLinkPayload,
    StoreSetter,
    VeltraState,
} from '../types';

export function createCreationActions(
    set: StoreSetter
): Pick<
    VeltraState,
    'addConfiguredNode' | 'addConfiguredNodes' | 'resetLayout' | 'clearAll'
> {
    return {
        addConfiguredNode: (
            kind: SupportedKind,
            resource: K8sResource,
            link?: ConfigMapLinkPayload | PvcLinkPayload | SecretLinkPayload | IngressTlsPayload
        ) =>
            set((state) => {
                const name = resource.metadata?.name?.trim();
                if (!name) return {};
                if (state.nodes.some((n) => n.data.kind === kind && n.data.name === name)) {
                    return {}; // modal validates and surfaces this
                }
                // Let buildGraph auto-place the new resource (lane/cursor layout).
                // A stale saved position from a previously deleted resource with
                // the same kind+name would bypass the lane AND the placement
                // repair; clear it so the node lands fresh, inside its box.
                clearSavedPositions([`${kind}:${name}`]);
                let resources = [...toResources(state.nodes), resource];
                const newIdx = resources.length - 1;
                // Create-modal ConfigMap link: also write the reference into the target
                // resource's Pod spec in the same commit (synthetic targets are already
                // resolved to their real owner by the modal).
                if (link && 'targetKind' in link && 'mechanism' in link) {
                    if (link.mechanism === 'envFrom' || link.mechanism === 'volumes' || link.mechanism === 'envKey') {
                        if (kind === 'ConfigMap') {
                            const cmIdx = newIdx;
                            const targetIdx = resources.findIndex(
                                (r) => r.kind === link.targetKind && r.metadata.name === link.targetName
                            );
                            if (targetIdx >= 0) {
                                resources = linkConfigMapToWorkload(
                                    resources,
                                    cmIdx,
                                    targetIdx,
                                    link.mechanism,
                                    link.key
                                ).resources;
                            }
                        } else if (kind === 'Secret') {
                            const secretIdx = newIdx;
                            const targetIdx = resources.findIndex(
                                (r) => r.kind === link.targetKind && r.metadata.name === link.targetName
                            );
                            if (targetIdx >= 0) {
                                resources = linkSecretToWorkload(
                                    resources,
                                    secretIdx,
                                    targetIdx,
                                    link.mechanism,
                                    link.key,
                                    'volumeName' in link ? link.volumeName : undefined
                                ).resources;
                            }
                        }
                    }
                }
                // Create-modal Ingress TLS: write spec.tls[] directly on the new Ingress.
                if (link && 'secretName' in link) {
                    const ingressSpec = (resources[newIdx].spec ?? {}) as Record<string, any>;
                    const tls: any[] = Array.isArray(ingressSpec.tls) ? ingressSpec.tls : [];
                    tls.push({ secretName: link.secretName, hosts: link.hosts });
                    ingressSpec.tls = tls;
                }
                // Create-modal PVC links: mount the claim into a Pod, Deployment or
                // ReplicaSet (volume name prompt; workloads get the reference in their
                // Pod template) and bind it to exactly one PV or StorageClass.
                if (link && 'mountTarget' in link) {
                    if (link.mountTarget) {
                        const targetIdx = resources.findIndex(
                            (r) =>
                                r.kind === link.mountTarget!.kind &&
                                r.metadata.name === link.mountTarget!.name
                        );
                        if (targetIdx >= 0) {
                            resources = linkPvcToWorkload(
                                resources,
                                newIdx,
                                targetIdx,
                                link.mountTarget.volumeName
                            ).resources;
                        }
                    }
                    if (link.bindTarget) {
                        const bindIdx = resources.findIndex(
                            (r) =>
                                r.kind === link.bindTarget!.kind &&
                                r.metadata.name === link.bindTarget!.name
                        );
                        if (bindIdx >= 0) {
                            const pvcSpec = (resources[newIdx].spec ?? {}) as Record<string, any>;
                            if (link.bindTarget.kind === 'PersistentVolume') {
                                pvcSpec.volumeName = link.bindTarget.name;
                                delete pvcSpec.storageClassName;
                            } else {
                                pvcSpec.storageClassName = link.bindTarget.name;
                                delete pvcSpec.volumeName;
                            }
                        }
                    }
                }
                return commitResources(state, resources, state.nodes, {
                    selectedResource: { kind, name },
                });
            }),

        addConfiguredNodes: (resources: K8sResource[], selectedResource) =>
            set((state) => {
                // Validate the whole batch before touching the model: every resource
                // needs a name and no kind+name may collide with the live canvas.
                const existing = toResources(state.nodes);
                const names = new Set<string>();
                for (const resource of resources) {
                    const name = resource.metadata?.name?.trim();
                    if (!name) return {}; // modal validates and surfaces this
                    const key = `${resource.kind}:${name}`;
                    if (names.has(key)) return {};
                    names.add(key);
                    if (existing.some((r) => r.kind === resource.kind && r.metadata.name === name)) {
                        return {};
                    }
                    // Fresh placement: never inherit a stale pin from a previously
                    // deleted resource with the same kind+name.
                    clearSavedPositions([key]);
                }
                // The batch is already cross-referenced (gatewayClassName / parentRefs /
                // backendRefs are baked in by the modal); commit everything at once so
                // the graph, inferred edges and YAML rebuild in one pass.
                return commitResources(state, [...existing, ...resources], state.nodes, {
                    selectedResource: selectedResource ?? null,
                });
            }),

        resetLayout: () => {
            localStorage.removeItem(POSITIONS_KEY);
            localStorage.removeItem(NS_LAYOUT_KEY);
            set((state) => {
                // Rebuild with no previous coordinates so every node returns to auto-layout.
                // HorizontalPodAutoscaler clamps are already written into the node resources; re-run the
                // override pass so the status bar reflects the current state.
                const resources = toResources(state.nodes);
                const hpaOverrides = applyHpaReplicaOverrides(resources);
                // resetLayout discards the layout entirely (nsLayout: null below),
                // so the repair pass runs in pure auto mode, with no layout to grow.
                const derivedResult = deriveGraph(resources, [], state.userEdges, null);
                const { layoutChanged, ...derived } = derivedResult;
                if (layoutChanged && derived.nsLayout) {
                    persistNsLayout(derived.nsLayout);
                }
                return {
                    ...derived,
                    hpaOverrides,
                    // Namespace/cluster frames re-derive from the fresh auto-layout.
                    nsLayout: null,
                    // Re-validate the active file after the layout reset rebuild.
                    ...(state.fileExplorerMode ? fileViewOf(resources, state.activeFile) : {}),
                };
            });
        },

        clearAll: () => {
            localStorage.setItem(YAML_KEY, '');
            localStorage.removeItem(POSITIONS_KEY);
            localStorage.removeItem(NS_LAYOUT_KEY);
            set({
                yaml: '',
                nodes: [],
                inferredEdges: [],
                edges: [],
                userEdges: [],
                selectedResource: null,
                yamlError: null,
                notice: null,
                hpaOverrides: [],
                pendingConfigMapLink: null,
                pendingPvcLink: null,
                pendingSecretLink: null,
                pendingIngressTlsLink: null,
                nsEditMode: false,
                nsLayout: null,
                activeFile: null,
                activeFileText: '',
                fileYamlError: null,
            });
        },
    };
}
