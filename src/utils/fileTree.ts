import type { Node } from '@xyflow/react';
import type { K8sResource, SupportedKind } from '../types/types';
import {
    getConfigMapRefs,
    getHpaTarget,
    getIngressServiceNames,
    getIngressTlsSecretNames,
    getPvcRefs,
    getRouteBackendRefNames,
    getSecretRefs,
    getSelector,
    getVpaTarget,
    getWorkloadPodLabels,
    isRouteKind,
    matchesSelector,
    type K8sNodeData,
} from './buildGraph';
import { isClusterScoped } from './k8sScope';
import { resourcesToYaml } from './serializeYaml';

/**
 * VSCode-style file explorer projection of the single-manifest model.
 *
 * The manifest stays ONE YAML document (the store's `yaml` string); this module
 * derives a virtual file tree from the live resources using best-practice
 * Kubernetes architecture:
 *
 * - cluster/            — cluster-scoped kinds (StorageClass, PersistentVolume,
 *                         GatewayClass), one file per resource.
 * - <namespace>/<app>/  — namespaced resources grouped into "applications": a
 *                         workload (Deployment/ReplicaSet/Pod/Job/CronJob) plus
 *                         everything its reference graph pulls in (Services,
 *                         Ingresses + TLS Secrets, HPA/VPA, ConfigMaps, Secrets,
 *                         PVCs, Gateway API Routes). Files hold one resource
 *                         kind; autoscalers are bundled with their target.
 * - <namespace>/_gateway/<name>.yaml — Gateways (shared infra, never app-bound).
 * - <namespace>/_misc/<kind>.yaml     — orphaned resources, grouped by kind.
 *
 * Assignment is single and deterministic (first app wins, in sorted order), so
 * the tree is a pure function of the resource list and stays in sync with the
 * canvas on every commit.
 */

/** A file's resource identity (kind + name), matching the store's selection shape. */
export interface FileResourceRef {
    kind: SupportedKind;
    name: string;
}

export interface FileNode {
    type: 'folder' | 'file';
    name: string;
    /** Unique path/id, e.g. `default/my-app/deployment.yaml`. */
    path: string;
    children?: FileNode[];
    /** Resources contained in a file node (undefined for folders). */
    resources?: FileResourceRef[];
    /** Resource count (files: contained; folders: recursive). */
    count?: number;
}

export interface FileExplorerData {
    tree: FileNode;
    /** Resource key `${kind}:${name}` → file path. */
    fileOf: Map<string, string>;
}

const WORKLOAD_KINDS: SupportedKind[] = ['Deployment', 'DaemonSet', 'StatefulSet', 'ReplicaSet', 'Pod', 'Job', 'CronJob'];

const CLUSTER_FOLDERS: Record<string, string> = {
    StorageClass: 'storage-classes',
    PersistentVolume: 'persistent-volumes',
    GatewayClass: 'gateway-classes',
};

const APP_FILE_NAMES: Record<string, string> = {
    Deployment: 'deployment.yaml',
    DaemonSet: 'daemonset.yaml',
    StatefulSet: 'statefulset.yaml',
    ReplicaSet: 'replicaset.yaml',
    Pod: 'pod.yaml',
    Job: 'job.yaml',
    CronJob: 'cronjob.yaml',
    Service: 'service.yaml',
    Ingress: 'ingress.yaml',
    ConfigMap: 'configmap.yaml',
    Secret: 'secret.yaml',
    PersistentVolumeClaim: 'pvc.yaml',
};

const FILE_ORDER = [
    'deployment.yaml',
    'daemonset.yaml',
    'statefulset.yaml',
    'replicaset.yaml',
    'pod.yaml',
    'job.yaml',
    'cronjob.yaml',
    'service.yaml',
    'ingress.yaml',
    'configmap.yaml',
    'secret.yaml',
    'pvc.yaml',
    'route.yaml',
];

interface AppGroup {
    ns: string;
    appName: string;
    workloads: K8sResource[];
    services: K8sResource[];
    hpas: K8sResource[];
    vpas: K8sResource[];
    cms: K8sResource[];
    secrets: K8sResource[];
    pvcs: K8sResource[];
    ingresses: K8sResource[];
    tlsSecrets: K8sResource[];
    routes: K8sResource[];
}

/** The real (non-synthetic) resource list behind the canvas nodes, normalized the
 *  same way the store's `toResources` does (node data is the source of truth). */
export function realResourcesOf(nodes: Node<K8sNodeData>[]): K8sResource[] {
    return nodes.filter((n) => !n.data.synthetic).map((n) => {
        const data = n.data;
        const metadataBase = data.resource?.metadata ?? {};
        const metadata = {
            ...metadataBase,
            name: data.name,
            ...(data.namespace ? { namespace: data.namespace } : {}),
        };
        if (!data.namespace && 'namespace' in metadata) {
            delete metadata.namespace;
        }
        return {
            ...data.resource,
            kind: data.kind,
            metadata,
        } as K8sResource;
    });
}

/** Canonical file-map key for a resource. */
export function resourceKeyOf(r: { kind: string; metadata: { name: string } }): string {
    return `${r.kind}:${r.metadata.name}`;
}

/** The application a workload anchors: `app` label, then `app.kubernetes.io/name`,
 *  then the workload's own name. */
function appKeyOf(r: K8sResource): string {
    const labels = r.metadata?.labels ?? {};
    return labels['app'] ?? labels['app.kubernetes.io/name'] ?? r.metadata.name;
}

function nsOf(r: K8sResource): string {
    return r.metadata?.namespace ?? 'default';
}

function miscFileName(r: K8sResource): string {
    if (isRouteKind(r.kind)) return 'route.yaml';
    return APP_FILE_NAMES[r.kind] ?? `${r.kind.toLowerCase()}.yaml`;
}

/**
 * The core grouping pass: every real resource → its virtual file path.
 * Pure over the resource list, single-assignment (first app, in sorted
 * (namespace, app) order, claims each resource).
 */
export function computeFileOf(resources: K8sResource[]): Map<string, string> {
    const fileOf = new Map<string, string>();

    // Cluster-scoped kinds: one file per resource under cluster/.
    for (const r of resources) {
        if (!isClusterScoped(r.kind)) continue;
        const folder = CLUSTER_FOLDERS[r.kind];
        if (!folder) continue;
        fileOf.set(resourceKeyOf(r), `cluster/${folder}/${r.metadata.name}.yaml`);
    }

    const rest = resources.filter((r) => !isClusterScoped(r.kind));
    const workloads = rest.filter((r) => WORKLOAD_KINDS.includes(r.kind));
    const gateways = rest.filter((r) => r.kind === 'Gateway');

    // Group workloads into apps by (namespace, app label/name).
    const appByKey = new Map<string, AppGroup>();
    for (const w of workloads) {
        const ns = nsOf(w);
        const appName = appKeyOf(w);
        const key = `${ns}\u0000${appName}`;
        let g = appByKey.get(key);
        if (!g) {
            g = {
                ns,
                appName,
                workloads: [],
                services: [],
                hpas: [],
                vpas: [],
                cms: [],
                secrets: [],
                pvcs: [],
                ingresses: [],
                tlsSecrets: [],
                routes: [],
            };
            appByKey.set(key, g);
        }
        g.workloads.push(w);
    }

    const appGroups = [...appByKey.values()].sort((a, b) =>
        a.ns === b.ns ? a.appName.localeCompare(b.appName) : a.ns.localeCompare(b.ns)
    );
    const claimed = new Set<string>();
    // Workloads always belong to their own app — mark them claimed so the misc
    // pass never re-assigns them to _misc/.
    for (const g of appGroups) {
        for (const w of g.workloads) claimed.add(resourceKeyOf(w));
    }

    for (const g of appGroups) {
        const free = (r: K8sResource) => !claimed.has(resourceKeyOf(r));
        const inNs = (r: K8sResource) => nsOf(r) === g.ns;
        // Only claim resources that fully matched — claiming inside the filter
        // predicate would poison orphans (matched kinds are skipped by _misc).
        const claim = (list: K8sResource[]) => {
            for (const r of list) claimed.add(resourceKeyOf(r));
            return list;
        };

        // Services selecting any of the app's workloads.
        g.services = claim(
            rest.filter(
                (r) =>
                    r.kind === 'Service' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => matchesSelector(getSelector(r) ?? {}, getWorkloadPodLabels(w)))
            )
        );
        // Autoscalers targeting any of the app's workloads.
        g.hpas = claim(
            rest.filter(
                (r) =>
                    r.kind === 'HorizontalPodAutoscaler' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => {
                        const t = getHpaTarget(r);
                        return !!t && t.kind === w.kind && t.name === w.metadata.name;
                    })
            )
        );
        g.vpas = claim(
            rest.filter(
                (r) =>
                    r.kind === 'VerticalPodAutoscaler' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => {
                        const t = getVpaTarget(r);
                        return !!t && t.kind === w.kind && t.name === w.metadata.name;
                    })
            )
        );
        // Config/secret/volume references from the app's pod specs.
        g.cms = claim(
            rest.filter(
                (r) =>
                    r.kind === 'ConfigMap' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => getConfigMapRefs(w).includes(r.metadata.name))
            )
        );
        g.secrets = claim(
            rest.filter(
                (r) =>
                    r.kind === 'Secret' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => getSecretRefs(w).includes(r.metadata.name))
            )
        );
        g.pvcs = claim(
            rest.filter(
                (r) =>
                    r.kind === 'PersistentVolumeClaim' &&
                    inNs(r) &&
                    free(r) &&
                    g.workloads.some((w) => getPvcRefs(w).includes(r.metadata.name))
            )
        );
        // Ingresses backing the app's services (+ their TLS secrets).
        const svcNames = new Set(g.services.map((s) => s.metadata.name));
        g.ingresses = claim(
            rest.filter(
                (r) =>
                    r.kind === 'Ingress' &&
                    inNs(r) &&
                    free(r) &&
                    getIngressServiceNames(r).some((sn) => svcNames.has(sn))
            )
        );
        g.tlsSecrets = claim(
            rest.filter(
                (r) =>
                    r.kind === 'Secret' &&
                    inNs(r) &&
                    free(r) &&
                    g.ingresses.some((ing) => getIngressTlsSecretNames(ing).includes(r.metadata.name))
            )
        );
        // Gateway API routes routing to the app's services.
        g.routes = claim(
            rest.filter(
                (r) =>
                    isRouteKind(r.kind) &&
                    inNs(r) &&
                    free(r) &&
                    getRouteBackendRefNames(r).some((sn) => svcNames.has(sn))
            )
        );
    }

    // Assign file paths per app. Autoscalers ride along with the workload they target.
    for (const g of appGroups) {
        const base = `${g.ns}/${g.appName}`;
        for (const kind of WORKLOAD_KINDS) {
            const ws = g.workloads.filter((w) => w.kind === kind);
            if (!ws.length) continue;
            const targets = new Set(ws.map((w) => w.metadata.name));
            const scalers = [...g.hpas, ...g.vpas].filter((r) => {
                const t = getHpaTarget(r) ?? getVpaTarget(r);
                return !!t && t.kind === kind && targets.has(t.name);
            });
            const path = `${base}/${APP_FILE_NAMES[kind]}`;
            for (const w of [...ws, ...scalers]) fileOf.set(resourceKeyOf(w), path);
        }
        for (const s of g.services) fileOf.set(resourceKeyOf(s), `${base}/service.yaml`);
        for (const ing of g.ingresses) fileOf.set(resourceKeyOf(ing), `${base}/ingress.yaml`);
        // A Secret consumed by a pod spec lands in secret.yaml; a TLS-only Secret
        // stays with the Ingress that terminates it.
        const podRefNames = new Set(g.secrets.map((s) => s.metadata.name));
        for (const s of g.secrets) fileOf.set(resourceKeyOf(s), `${base}/secret.yaml`);
        for (const s of g.tlsSecrets) {
            fileOf.set(resourceKeyOf(s), podRefNames.has(s.metadata.name) ? `${base}/secret.yaml` : `${base}/ingress.yaml`);
        }
        for (const cm of g.cms) fileOf.set(resourceKeyOf(cm), `${base}/configmap.yaml`);
        for (const p of g.pvcs) fileOf.set(resourceKeyOf(p), `${base}/pvc.yaml`);
        for (const r of g.routes) fileOf.set(resourceKeyOf(r), `${base}/route.yaml`);
    }

    // Shared Gateways: one file per Gateway, never bound to a single app.
    for (const gw of gateways) {
        fileOf.set(resourceKeyOf(gw), `${nsOf(gw)}/_gateway/${gw.metadata.name}.yaml`);
    }

    // Orphans: unclaimed namespaced resources grouped by kind under _misc/.
    const misc = new Map<string, K8sResource[]>();
    for (const r of rest) {
        if (r.kind === 'Gateway' || claimed.has(resourceKeyOf(r))) continue;
        const key = `${nsOf(r)}\u0000${miscFileName(r)}`;
        const list = misc.get(key) ?? [];
        list.push(r);
        misc.set(key, list);
    }
    for (const [key, list] of misc) {
        const idx = key.indexOf('\u0000');
        const ns = key.slice(0, idx);
        const fileName = key.slice(idx + 1);
        const path = `${ns}/_misc/${fileName}`;
        for (const r of list) fileOf.set(resourceKeyOf(r), path);
    }

    return fileOf;
}

function fileRank(name: string): number {
    const i = FILE_ORDER.indexOf(name);
    return i === -1 ? FILE_ORDER.length : i;
}

function folderRank(name: string): number {
    if (name === 'cluster') return 0;
    if (name === 'default') return 1;
    if (name.startsWith('_')) return 3;
    return 2;
}

/** Sort children (folders first, then by rank/name) and compute recursive counts. */
function sortAndCount(node: FileNode): number {
    if (node.type === 'file') {
        node.count = node.resources?.length ?? 0;
        return node.count;
    }
    if (node.children) {
        node.children.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            if (a.type === 'folder') {
                const rank = folderRank(a.name) - folderRank(b.name);
                return rank !== 0 ? rank : a.name.localeCompare(b.name);
            }
            const rank = fileRank(a.name) - fileRank(b.name);
            return rank !== 0 ? rank : a.name.localeCompare(b.name);
        });
        let total = 0;
        for (const child of node.children) total += sortAndCount(child);
        node.count = total;
        return total;
    }
    node.count = 0;
    return 0;
}

/** Build the folder/file tree from the file assignments. */
export function buildFileTree(fileOf: Map<string, string>): FileNode {
    const files = new Map<string, FileResourceRef[]>();
    for (const [key, path] of fileOf) {
        const sep = key.indexOf(':');
        const kind = key.slice(0, sep) as SupportedKind;
        const name = key.slice(sep + 1);
        const list = files.get(path) ?? [];
        list.push({ kind, name });
        files.set(path, list);
    }

    const root: FileNode = { type: 'folder', name: '', path: '' };
    for (const [path, refs] of files) {
        const parts = path.split('/');
        let cur = root;
        for (let i = 0; i < parts.length - 1; i += 1) {
            const name = parts[i];
            cur.children ??= [];
            let child = cur.children.find((c) => c.type === 'folder' && c.name === name);
            if (!child) {
                child = { type: 'folder', name, path: parts.slice(0, i + 1).join('/') };
                cur.children.push(child);
            }
            cur = child;
        }
        cur.children ??= [];
        cur.children.push({ type: 'file', name: parts[parts.length - 1], path, resources: refs });
    }
    sortAndCount(root);
    return root;
}

/** The full explorer projection: normalized resources, file map and tree. */
export function buildFileExplorer(nodes: Node<K8sNodeData>[]): FileExplorerData {
    const resources = realResourcesOf(nodes);
    const fileOf = computeFileOf(resources);
    const tree = buildFileTree(fileOf);
    return { tree, fileOf };
}

/** The canonical YAML text of one virtual file (resources that map to `path`). */
export function fileTextOf(resources: K8sResource[], path: string): string {
    const fileOf = computeFileOf(resources);
    const members = resources.filter((r) => fileOf.get(resourceKeyOf(r)) === path);
    return resourcesToYaml(members);
}

/**
 * Validate a file path against the current tree and produce the active file view
 * (path + canonical text). Returns `activeFile: null` when the path is gone.
 */
export function fileViewOf(
    resources: K8sResource[],
    path: string | null
): { activeFile: string | null; activeFileText: string } {
    if (!path) return { activeFile: null, activeFileText: '' };
    const fileOf = computeFileOf(resources);
    const paths = new Set(fileOf.values());
    if (!paths.has(path)) return { activeFile: null, activeFileText: '' };
    return { activeFile: path, activeFileText: fileTextOf(resources, path) };
}