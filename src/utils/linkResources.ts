import type { K8sResource, SupportedKind } from '../types/types';
import { getSelector, getWorkloadPodLabels } from './buildGraph';

/**
 * Semantic manual linking.
 *
 * When the user draws a connection between two nodes on the canvas we express
 * that relationship in the actual Kubernetes model (selectors, labels, ingress backends)
 * so it survives re-renders, round-trips through YAML, and shows up as a real inferred
 * relationship. Pairs with no K8s meaning return null — the store rejects them with
 * the message from `explainInvalidLink` instead of drawing a meaningless edge.
 *
 * Direction-agnostic: dragging Service→Pod and Pod→Service mean the same thing.
 */
export function connectResources(
    resources: K8sResource[],
    sourceIdx: number,
    targetIdx: number
): { resources: K8sResource[]; description: string } | null {
    const source = resources[sourceIdx];
    const target = resources[targetIdx];
    if (!source || !target) return null;

    const pair = (a: string, b: string) =>
        (source.kind === a && target.kind === b) || (source.kind === b && target.kind === a);
    const byKind = (kind: string) => (source.kind === kind ? sourceIdx : targetIdx);

    if (pair('Ingress', 'Service')) {
        return linkIngressToService(resources, byKind('Ingress'), byKind('Service'));
    }
    if (pair('Service', 'Pod')) {
        return linkServiceToPod(resources, byKind('Service'), byKind('Pod'));
    }
    if (pair('Service', 'Deployment') || pair('Service', 'ReplicaSet')) {
        const workloadIdx = source.kind === 'Service' ? targetIdx : sourceIdx;
        return linkServiceToWorkload(resources, byKind('Service'), workloadIdx);
    }
    if (pair('Deployment', 'ReplicaSet')) {
        return linkOwnership(resources, byKind('Deployment'), byKind('ReplicaSet'));
    }
    if (pair('ReplicaSet', 'Pod')) {
        return linkOwnership(resources, byKind('ReplicaSet'), byKind('Pod'));
    }
    if (pair('Deployment', 'Pod')) {
        // Auto-correct: Deployments never own Pods directly in Kubernetes. Labeling the
        // Pod with the Deployment's selector lets its ReplicaSet adopt it instead.
        const result = linkOwnership(resources, byKind('Deployment'), byKind('Pod'));
        const podName = resources[byKind('Pod')].metadata.name;
        const depName = resources[byKind('Deployment')].metadata.name;
        return {
            ...result,
            description: `${podName} adopted by ${depName}'s ReplicaSet (Deployments own Pods via ReplicaSets)`,
        };
    }
    if (pair('HPA', 'Deployment') || pair('HPA', 'ReplicaSet')) {
        return linkHpaToWorkload(
            resources,
            byKind('HPA'),
            source.kind === 'HPA' ? targetIdx : sourceIdx
        );
    }
    return null;
}

/** Human-readable reason why two kinds cannot be linked, with guidance on what to do instead. */
export function explainInvalidLink(a: SupportedKind, b: SupportedKind): string {
    const pair = (x: SupportedKind, y: SupportedKind) => (a === x && b === y) || (a === y && b === x);

    if (pair('Ingress', 'Pod')) {
        return 'An Ingress cannot route to a Pod directly — route it to a Service that selects the Pod.';
    }
    if (pair('Ingress', 'Deployment') || pair('Ingress', 'ReplicaSet')) {
        return `An Ingress cannot route to a ${a === 'Ingress' ? b : a} — expose the workload with a Service first, then route the Ingress to it.`;
    }
    if (pair('HPA', 'Service') || pair('HPA', 'Ingress') || pair('HPA', 'Pod')) {
        const other = a === 'HPA' ? b : a;
        return `An HPA can only scale a Deployment or ReplicaSet, not a ${other}.`;
    }
    if (a === b) {
        return `Two ${a} resources have no direct relationship in Kubernetes.`;
    }
    return `${a} and ${b} have no valid Kubernetes relationship.`;
}

/** Point the Ingress default rule/path backend at the Service. */
function linkIngressToService(
    resources: K8sResource[],
    ingressIdx: number,
    serviceIdx: number
): { resources: K8sResource[]; description: string } {
    const service = resources[serviceIdx];
    const svcSpec = service.spec as { ports?: Array<{ port?: number }> } | undefined;
    const portNumber = svcSpec?.ports?.[0]?.port ?? 80;

    const next = [...resources];
    const ingress = clone(resources[ingressIdx]);
    const spec = (ingress.spec ?? {}) as Record<string, any>;
    const rules: any[] = Array.isArray(spec.rules) && spec.rules.length ? spec.rules : [{}];
    const rule = rules[0];
    rule.http = rule.http ?? {};
    const paths: any[] = Array.isArray(rule.http.paths) && rule.http.paths.length
        ? rule.http.paths
        : [{ path: '/', pathType: 'Prefix' }];
    paths[0].backend = {
        service: { name: service.metadata.name, port: { number: portNumber } },
    };
    rule.http.paths = paths;
    spec.rules = rules;
    ingress.spec = spec;
    next[ingressIdx] = ingress;

    return { resources: next, description: `Ingress now routes to ${service.metadata.name}` };
}

/** Make the Service select the Pod's labels (creating an app label if the Pod has none). */
function linkServiceToPod(
    resources: K8sResource[],
    serviceIdx: number,
    podIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const pod = clone(resources[podIdx]);
    let labels = pod.metadata.labels;
    if (!labels || Object.keys(labels).length === 0) {
        labels = { app: pod.metadata.name };
        pod.metadata.labels = labels;
        next[podIdx] = pod;
    }

    const service = clone(resources[serviceIdx]);
    const spec = (service.spec ?? {}) as Record<string, any>;
    spec.selector = { ...labels };
    service.spec = spec;
    next[serviceIdx] = service;

    return { resources: next, description: `Service selector set to match ${pod.metadata.name}` };
}

/** Make the Service select the workload's pod-template labels. */
function linkServiceToWorkload(
    resources: K8sResource[],
    serviceIdx: number,
    workloadIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    let workload = resources[workloadIdx];
    let labels = getWorkloadPodLabels(workload);

    if (!labels || Object.keys(labels).length === 0) {
        // Workload has no identifying labels yet — establish an app label on it
        workload = clone(workload);
        labels = { app: workload.metadata.name };
        workload.metadata.labels = { ...(workload.metadata.labels ?? {}), ...labels };
        const wSpec = (workload.spec ?? {}) as Record<string, any>;
        wSpec.selector = { matchLabels: { ...labels } };
        workload.spec = wSpec;
        next[workloadIdx] = workload;
    }

    const service = clone(resources[serviceIdx]);
    const spec = (service.spec ?? {}) as Record<string, any>;
    spec.selector = { ...labels };
    service.spec = spec;
    next[serviceIdx] = service;

    return { resources: next, description: `Service selector set to match ${workload.metadata.name}` };
}

/**
 * Establish an ownership chain (Deployment→ReplicaSet or ReplicaSet→Pod) by ensuring the
 * parent has a selector and the child carries matching labels. The graph builder then
 * renders the child nested inside the parent.
 */
function linkOwnership(
    resources: K8sResource[],
    parentIdx: number,
    childIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    let parent = resources[parentIdx];
    let selectorLabels = getSelector(parent);

    if (!selectorLabels || Object.keys(selectorLabels).length === 0) {
        parent = clone(parent);
        selectorLabels = { app: parent.metadata.name };
        parent.metadata.labels = { ...(parent.metadata.labels ?? {}), ...selectorLabels };
        const pSpec = (parent.spec ?? {}) as Record<string, any>;
        pSpec.selector = { matchLabels: { ...selectorLabels } };
        parent.spec = pSpec;
        next[parentIdx] = parent;
    }

    const child = clone(resources[childIdx]);
    child.metadata.labels = { ...(child.metadata.labels ?? {}), ...selectorLabels };
    if (child.kind === 'ReplicaSet') {
        // Keep the chain intact: the ReplicaSet should select its own pods with the same labels
        const cSpec = (child.spec ?? {}) as Record<string, any>;
        const existing = getSelector(child);
        if (!existing || Object.keys(existing).length === 0) {
            cSpec.selector = { matchLabels: { ...selectorLabels } };
            child.spec = cSpec;
        }
    }
    next[childIdx] = child;

    return {
        resources: next,
        description: `${child.metadata.name} is now owned by ${parent.metadata.name}`,
    };
}

/** Point the HPA's scaleTargetRef at the workload. */
function linkHpaToWorkload(
    resources: K8sResource[],
    hpaIdx: number,
    workloadIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const workload = resources[workloadIdx];

    const hpa = clone(resources[hpaIdx]);
    const spec = (hpa.spec ?? {}) as Record<string, any>;
    spec.scaleTargetRef = {
        apiVersion: 'apps/v1',
        kind: workload.kind,
        name: workload.metadata.name,
    };
    if (typeof spec.minReplicas !== 'number') spec.minReplicas = 1;
    if (typeof spec.maxReplicas !== 'number') spec.maxReplicas = 10;
    hpa.spec = spec;
    next[hpaIdx] = hpa;

    return {
        resources: next,
        description: `${hpa.metadata.name} now scales ${workload.kind} ${workload.metadata.name}`,
    };
}

function clone<T>(value: T): T {
    return structuredClone(value);
}
