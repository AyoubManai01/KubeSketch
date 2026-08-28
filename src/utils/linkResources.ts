import type { K8sResource, SupportedKind } from '../types/types';
import { getSelector, getWorkloadPodLabels, isRouteKind } from './buildGraph';

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
    if (pair('Service', 'Deployment') || pair('Service', 'ReplicaSet') || pair('Service', 'Job')) {
        const workloadIdx = source.kind === 'Service' ? targetIdx : sourceIdx;
        return linkServiceToWorkload(resources, byKind('Service'), workloadIdx);
    }
    if (pair('Deployment', 'ReplicaSet')) {
        return linkOwnership(resources, byKind('Deployment'), byKind('ReplicaSet'));
    }
    if (pair('ReplicaSet', 'Pod')) {
        return linkOwnership(resources, byKind('ReplicaSet'), byKind('Pod'));
    }
    if (pair('Job', 'Pod')) {
        return linkOwnership(resources, byKind('Job'), byKind('Pod'));
    }
    if (pair('CronJob', 'Job')) {
        // A CronJob never links to an existing Job — it creates its own (shown as a
        // synthetic node). Rejected so no meaningless edge lands on the canvas.
        return null;
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
    if (pair('HorizontalPodAutoscaler', 'Deployment') || pair('HorizontalPodAutoscaler', 'ReplicaSet')) {
        return linkHpaToWorkload(
            resources,
            byKind('HorizontalPodAutoscaler'),
            source.kind === 'HorizontalPodAutoscaler' ? targetIdx : sourceIdx
        );
    }
    if (
        pair('VerticalPodAutoscaler', 'Deployment') ||
        pair('VerticalPodAutoscaler', 'ReplicaSet') ||
        pair('VerticalPodAutoscaler', 'Pod') ||
        pair('VerticalPodAutoscaler', 'Job') ||
        pair('VerticalPodAutoscaler', 'CronJob')
    ) {
        return linkVpaToTarget(
            resources,
            byKind('VerticalPodAutoscaler'),
            source.kind === 'VerticalPodAutoscaler' ? targetIdx : sourceIdx
        );
    }
    if (pair('PersistentVolumeClaim', 'PersistentVolume')) {
        return linkPvcToPv(resources, byKind('PersistentVolumeClaim'), byKind('PersistentVolume'));
    }
    if (pair('PersistentVolumeClaim', 'StorageClass')) {
        return linkPvcToStorageClass(
            resources,
            byKind('PersistentVolumeClaim'),
            byKind('StorageClass')
        );
    }
    if (pair('Gateway', 'GatewayClass')) {
        return linkGatewayToClass(resources, byKind('Gateway'), byKind('GatewayClass'));
    }
    if (
        pair('Gateway', 'HTTPRoute') ||
        pair('Gateway', 'GRPCRoute') ||
        pair('Gateway', 'TCPRoute') ||
        pair('Gateway', 'TLSRoute') ||
        pair('Gateway', 'UDPRoute')
    ) {
        const routeIdx = source.kind === 'Gateway' ? targetIdx : sourceIdx;
        return linkRouteToGateway(resources, routeIdx, byKind('Gateway'));
    }
    if (
        pair('Service', 'HTTPRoute') ||
        pair('Service', 'GRPCRoute') ||
        pair('Service', 'TCPRoute') ||
        pair('Service', 'TLSRoute') ||
        pair('Service', 'UDPRoute')
    ) {
        const routeIdx = source.kind === 'Service' ? targetIdx : sourceIdx;
        return linkRouteToService(resources, routeIdx, byKind('Service'));
    }
    // PVC ↔ Pod/Deployment/ReplicaSet is intercepted by the store (pending
    // volume-name prompt, single-node access-mode guard) and never reaches
    // connectResources.
    // Secret ↔ Pod/Deployment/ReplicaSet is intercepted by the store (pending
    // mechanism prompt) and never reaches connectResources.
    if (pair('Ingress', 'Secret')) {
        return linkIngressToSecret(resources, byKind('Ingress'), byKind('Secret'), []);
    }
    return null;
}

/** Human-readable reason why two kinds cannot be linked, with guidance on what to do instead. */
export function explainInvalidLink(a: SupportedKind, b: SupportedKind): string {
    const pair = (x: SupportedKind, y: SupportedKind) => (a === x && b === y) || (a === y && b === x);

    // Storage pairs: PVC mounts into Pods and binds to exactly one PV or StorageClass;
    // PVs and StorageClasses are only reachable through a PVC.
    if (a === 'PersistentVolumeClaim' || b === 'PersistentVolumeClaim') {
        const other = a === 'PersistentVolumeClaim' ? b : a;
        if (pair('PersistentVolumeClaim', 'Pod')) {
            return 'A PVC mounts into a Pod via spec.volumes[].persistentVolumeClaim — connect it to the Pod directly.';
        }
        if (pair('PersistentVolumeClaim', 'PersistentVolume')) {
            return 'A PVC already binds to this PV (spec.volumeName).';
        }
        if (pair('PersistentVolumeClaim', 'StorageClass')) {
            return 'A PVC already references this StorageClass (spec.storageClassName).';
        }
        if (other === 'Deployment' || other === 'ReplicaSet' || other === 'Job') {
            return `A PVC mounts into a ${other}'s Pod template — a single-node access mode (ReadWriteOnce/ReadWriteOncePod) cannot serve every replica when the ${other} runs more than one.`;
        }
        return `A PVC is claimed by a Pod and binds to a PV or StorageClass — it has no direct relationship with a ${other}.`;
    }
    if (a === 'PersistentVolume' || b === 'PersistentVolume') {
        const other = a === 'PersistentVolume' ? b : a;
        if (other === 'Pod' || other === 'Deployment' || other === 'ReplicaSet' || other === 'Job') {
            return `A ${other} cannot use a PV directly — claim it with a PVC (spec.volumeName) and mount the PVC into the Pod.`;
        }
        return `A PV is bound by a PVC via the claim's spec.volumeName — it has no direct relationship with a ${other}.`;
    }
    if (a === 'StorageClass' || b === 'StorageClass') {
        const other = a === 'StorageClass' ? b : a;
        if (other === 'Pod' || other === 'Deployment' || other === 'ReplicaSet' || other === 'Job') {
            return `A ${other} cannot reference a StorageClass directly — a PVC with spec.storageClassName provisions storage that the Pod then claims.`;
        }
        return `A StorageClass is referenced by a PVC via spec.storageClassName — it has no direct relationship with a ${other}.`;
    }

    if (a === 'ConfigMap' || b === 'ConfigMap') {
        const other = a === 'ConfigMap' ? b : a;
        return `A ConfigMap is consumed by a Pod spec (envFrom, env.valueFrom or volumes), not linked to a ${other} directly.`;
    }
    if (a === 'Secret' || b === 'Secret') {
        const other = a === 'Secret' ? b : a;
        if (other === 'Service') {
            return 'A Secret cannot be selected by a Service — Services select Pods by labels, Secrets are consumed by Pod specs or Ingress TLS.';
        }
        if (other === 'Ingress') {
            return 'An Ingress consumes a Secret via spec.tls[].secretName — drag an Ingress onto a Secret to configure TLS.';
        }
        if (other === 'HorizontalPodAutoscaler') {
            return 'A HorizontalPodAutoscaler scales Deployments/ReplicaSets, not Secrets.';
        }
        return `A Secret is consumed by a Pod spec (envFrom, env.valueFrom or volumes) or referenced by Ingress TLS, not linked to a ${other} directly.`;
    }
    if (pair('Ingress', 'Pod')) {
        return 'An Ingress cannot route to a Pod directly — route it to a Service that selects the Pod.';
    }
    if (pair('CronJob', 'Job')) {
        return 'A CronJob creates its own Job on each schedule tick — it cannot be linked to an existing Job. Connect a ConfigMap/Secret/PVC to the CronJob to configure its Pod template instead.';
    }
    if (pair('CronJob', 'Pod')) {
        return 'A CronJob does not own Pods directly — it creates a Job which runs the Pods. Configure the CronJob\u2019s Job template instead.';
    }
    if (a === 'CronJob' || b === 'CronJob') {
        const other = a === 'CronJob' ? b : a;
        if (other === 'Service') {
            return 'A Service selects Pods by labels — it already routes to a CronJob\u2019s Pods if their labels match.';
        }
        if (other === 'Ingress') {
            return 'An Ingress cannot route to a CronJob — expose its Pods with a Service first.';
        }
        if (other === 'HorizontalPodAutoscaler') {
            return 'A HorizontalPodAutoscaler scales Deployments/ReplicaSets, not CronJobs.';
        }
        return `A CronJob runs batch Jobs on a schedule — it has no direct relationship with a ${other}.`;
    }
    if (pair('Ingress', 'Deployment') || pair('Ingress', 'ReplicaSet') || pair('Ingress', 'Job')) {
        return `An Ingress cannot route to a ${a === 'Ingress' ? b : a} — expose the workload with a Service first, then route the Ingress to it.`;
    }
    if (pair('HorizontalPodAutoscaler', 'Service') || pair('HorizontalPodAutoscaler', 'Ingress') || pair('HorizontalPodAutoscaler', 'Pod') || pair('HorizontalPodAutoscaler', 'Job')) {
        const other = a === 'HorizontalPodAutoscaler' ? b : a;
        return `A HorizontalPodAutoscaler can only scale a Deployment or ReplicaSet, not a ${other}.`;
    }
    if (a === 'VerticalPodAutoscaler' || b === 'VerticalPodAutoscaler') {
        const other = a === 'VerticalPodAutoscaler' ? b : a;
        if (other === 'Service') {
            return 'A VPA right-sizes Pods (via a Deployment/ReplicaSet/Pod/Job/CronJob), not Services.';
        }
        if (other === 'Ingress') {
            return 'A VPA right-sizes Pods, not Ingresses.';
        }
        if (other === 'HorizontalPodAutoscaler') {
            return 'A VPA right-sizes container resource requests, while a HorizontalPodAutoscaler scales replica counts — the two are independent.';
        }
        return `A VPA right-sizes a Pod's containers — it has no direct relationship with a ${other}.`;
    }
    if (a === 'Gateway' || b === 'Gateway') {
        const other = (a === 'Gateway' ? b : a) as SupportedKind;
        if (other === 'GatewayClass') {
            return 'A Gateway already references this GatewayClass (spec.gatewayClassName).';
        }
        if (isRouteKind(other)) {
            return `A ${other} already attaches to this Gateway via spec.parentRefs.`;
        }
        if (other === 'Service') {
            return 'A Gateway listens for traffic at the namespace edge — it is not routed to Services. Connect the Service to a Route instead.';
        }
        return `A Gateway is created from exactly one GatewayClass (spec.gatewayClassName) and is attached by Routes — it has no direct relationship with a ${other}.`;
    }
    if (a === 'GatewayClass' || b === 'GatewayClass') {
        const other = (a === 'GatewayClass' ? b : a) as SupportedKind;
        if (other === 'Gateway') {
            return 'A GatewayClass is already referenced by this Gateway (spec.gatewayClassName).';
        }
        return `A GatewayClass is the template a Gateway is created from (spec.gatewayClassName) — it has no direct relationship with a ${other}.`;
    }
    if (isRouteKind(a) || isRouteKind(b)) {
        const routeKind = (isRouteKind(a) ? a : b) as SupportedKind;
        const other = (isRouteKind(a) ? b : a) as SupportedKind;
        if (other === 'Gateway') {
            return `A ${routeKind} already attaches to this Gateway via spec.parentRefs.`;
        }
        if (other === 'Service') {
            return `A ${routeKind} already routes to this Service via spec.backendRefs.`;
        }
        if (other === 'Deployment' || other === 'ReplicaSet' || other === 'Pod' || other === 'Job' || other === 'CronJob') {
            return `A ${routeKind} can only route to Services, not a ${other} — expose the workload with a Service first.`;
        }
        return `A ${routeKind} attaches to a Gateway (spec.parentRefs) and routes to Services (spec.backendRefs) — it has no direct relationship with a ${other}.`;
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

/** Point the HorizontalPodAutoscaler's scaleTargetRef at the workload. */
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

/** Point the VPA's targetRef at the workload/Pod it should right-size. A VPA
 *  has exactly one target — an existing targetRef is replaced. */
function linkVpaToTarget(
    resources: K8sResource[],
    vpaIdx: number,
    targetIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const target = resources[targetIdx];
    const targetApiVersion =
        target.kind === 'Deployment' || target.kind === 'ReplicaSet'
            ? 'apps/v1'
            : target.kind === 'Job' || target.kind === 'CronJob'
            ? 'batch/v1'
            : 'v1';

    const vpa = clone(resources[vpaIdx]);
    const spec = (vpa.spec ?? {}) as Record<string, any>;
    spec.targetRef = {
        apiVersion: targetApiVersion,
        kind: target.kind,
        name: target.metadata.name,
    };
    if (!spec.updatePolicy || typeof spec.updatePolicy.updateMode !== 'string') {
        spec.updatePolicy = { updateMode: 'Auto' };
    }
    vpa.spec = spec;
    next[vpaIdx] = vpa;

    return {
        resources: next,
        description: `${vpa.metadata.name} now right-sizes ${target.kind} ${target.metadata.name}`,
    };
}

/** How a ConfigMap is consumed by a workload's Pod spec. */
export type ConfigMapMechanism = 'envFrom' | 'volumes' | 'envKey';

/**
 * Write a ConfigMap reference into a workload (or standalone Pod) so it consumes
 * the ConfigMap. `envFrom` injects every data key as an env var, `volumes` mounts
 * the ConfigMap as files, `envKey` injects a single key via `configMapKeyRef`
 * (requires `key`). Workloads (Deployment/ReplicaSet) get the reference under
 * `spec.template.spec`; Pods use `spec` directly. De-dupes existing references.
 */
export function linkConfigMapToWorkload(
    resources: K8sResource[],
    configMapIdx: number,
    workloadIdx: number,
    mechanism: ConfigMapMechanism,
    key?: string
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const configMap = resources[configMapIdx];
    const workload = resources[workloadIdx];
    const cmName = configMap.metadata.name;

    const patched = clone(workload);
    const spec = (patched.spec ?? {}) as Record<string, any>;
    let podSpec: Record<string, any>;
    if (patched.kind === 'CronJob') {
        // CronJob pods are described inside the Job template: spec.jobTemplate.spec.template.spec.
        spec.jobTemplate = spec.jobTemplate ?? {};
        spec.jobTemplate.spec = spec.jobTemplate.spec ?? {};
        spec.jobTemplate.spec.template = spec.jobTemplate.spec.template ?? {};
        spec.jobTemplate.spec.template.spec = spec.jobTemplate.spec.template.spec ?? {};
        podSpec = spec.jobTemplate.spec.template.spec;
    } else if (patched.kind === 'Deployment' || patched.kind === 'ReplicaSet' || patched.kind === 'Job') {
        spec.template = spec.template ?? {};
        spec.template.spec = spec.template.spec ?? {};
        podSpec = spec.template.spec;
    } else {
        podSpec = spec;
    }

    podSpec.containers = Array.isArray(podSpec.containers) ? podSpec.containers : [{ name: 'app' }];
    const container = podSpec.containers[0];

    if (mechanism === 'envFrom') {
        container.envFrom = Array.isArray(container.envFrom) ? container.envFrom : [];
        if (!container.envFrom.some((ef: any) => ef?.configMapRef?.name === cmName)) {
            container.envFrom.push({ configMapRef: { name: cmName } });
        }
    } else if (mechanism === 'volumes') {
        podSpec.volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes : [];
        if (!podSpec.volumes.some((v: any) => v?.configMap?.name === cmName)) {
            podSpec.volumes.push({ name: cmName, configMap: { name: cmName } });
        }
    } else {
        const envName = key?.trim() || cmName;
        container.env = Array.isArray(container.env) ? container.env : [];
        if (!container.env.some((e: any) => e?.valueFrom?.configMapKeyRef?.name === cmName && e.valueFrom.configMapKeyRef.key === key)) {
            container.env.push({
                name: envName,
                valueFrom: { configMapKeyRef: { name: cmName, key } },
            });
        }
    }

    patched.spec = spec;
    next[workloadIdx] = patched;

    return {
        resources: next,
        description: `${patched.kind} ${patched.metadata.name} now consumes ${cmName} via ${mechanism}${mechanism === 'envKey' ? ` (key: ${key})` : ''}`,
    };
}

/** How a Secret is consumed by a workload's Pod spec. */
export type SecretMechanism = 'envFrom' | 'volumes' | 'envKey';

/**
 * Write a Secret reference into a workload (or standalone Pod) so it consumes
 * the Secret. `envFrom` injects every data key as an env var via `secretRef`,
 * `volumes` mounts the Secret as files via `volumes[].secret.secretName`
 * (optionally under a custom volume name), `envKey` injects a single key via
 * `secretKeyRef` (requires `key`). Workloads (Deployment/ReplicaSet) get the
 * reference under `spec.template.spec`; Pods use `spec` directly. De-dupes
 * existing references.
 */
export function linkSecretToWorkload(
    resources: K8sResource[],
    secretIdx: number,
    workloadIdx: number,
    mechanism: SecretMechanism,
    key?: string,
    volumeName?: string
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const secret = resources[secretIdx];
    const workload = resources[workloadIdx];
    const secretName = secret.metadata.name;

    const patched = clone(workload);
    const spec = (patched.spec ?? {}) as Record<string, any>;
    let podSpec: Record<string, any>;
    if (patched.kind === 'CronJob') {
        spec.jobTemplate = spec.jobTemplate ?? {};
        spec.jobTemplate.spec = spec.jobTemplate.spec ?? {};
        spec.jobTemplate.spec.template = spec.jobTemplate.spec.template ?? {};
        spec.jobTemplate.spec.template.spec = spec.jobTemplate.spec.template.spec ?? {};
        podSpec = spec.jobTemplate.spec.template.spec;
    } else if (patched.kind === 'Deployment' || patched.kind === 'ReplicaSet' || patched.kind === 'Job') {
        spec.template = spec.template ?? {};
        spec.template.spec = spec.template.spec ?? {};
        podSpec = spec.template.spec;
    } else {
        podSpec = spec;
    }

    podSpec.containers = Array.isArray(podSpec.containers) ? podSpec.containers : [{ name: 'app' }];
    const container = podSpec.containers[0];

    if (mechanism === 'envFrom') {
        container.envFrom = Array.isArray(container.envFrom) ? container.envFrom : [];
        if (!container.envFrom.some((ef: any) => ef?.secretRef?.name === secretName)) {
            container.envFrom.push({ secretRef: { name: secretName } });
        }
    } else if (mechanism === 'volumes') {
        const volume = volumeName?.trim() || secretName;
        podSpec.volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes : [];
        if (!podSpec.volumes.some((v: any) => v?.secret?.secretName === secretName)) {
            if (!podSpec.volumes.some((v: any) => v?.name === volume)) {
                podSpec.volumes.push({ name: volume, secret: { secretName } });
            } else {
                // Volume name is taken — fall back to a unique name derived from the secret
                let suffix = 2;
                while (podSpec.volumes.some((v: any) => v?.name === `${volume}-${suffix}`)) suffix++;
                podSpec.volumes.push({
                    name: `${volume}-${suffix}`,
                    secret: { secretName },
                });
            }
        }
    } else {
        const envName = key?.trim() || secretName;
        container.env = Array.isArray(container.env) ? container.env : [];
        if (!container.env.some((e: any) => e?.valueFrom?.secretKeyRef?.name === secretName && e.valueFrom.secretKeyRef.key === key)) {
            container.env.push({
                name: envName,
                valueFrom: { secretKeyRef: { name: secretName, key } },
            });
        }
    }

    patched.spec = spec;
    next[workloadIdx] = patched;

    return {
        resources: next,
        description: `${patched.kind} ${patched.metadata.name} now consumes ${secretName} via ${mechanism}${mechanism === 'envKey' ? ` (key: ${key})` : mechanism === 'volumes' && volumeName?.trim() ? ` (volume: ${volumeName.trim()})` : ''}`,
    };
}

/**
 * Terminate TLS on the Ingress with the given Secret: write/merge
 * `spec.tls[].secretName` (de-duping by secret name and replacing the hosts of
 * an existing entry). `hosts` is optional — an empty list matches all hosts.
 */
export function linkIngressToSecret(
    resources: K8sResource[],
    ingressIdx: number,
    secretIdx: number,
    hosts: string[]
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const secret = resources[secretIdx];
    const ingress = clone(resources[ingressIdx]);
    const spec = (ingress.spec ?? {}) as Record<string, any>;
    const tls: any[] = Array.isArray(spec.tls) ? spec.tls : [];

    const existing = tls.find((entry: any) => entry?.secretName === secret.metadata.name);
    const cleanHosts = hosts.map((h) => h.trim()).filter(Boolean);
    if (existing) {
        existing.hosts = cleanHosts;
    } else {
        tls.push({ secretName: secret.metadata.name, hosts: cleanHosts });
    }
    spec.tls = tls;
    ingress.spec = spec;
    next[ingressIdx] = ingress;

    return {
        resources: next,
        description: `Ingress ${ingress.metadata.name} now terminates TLS with Secret ${secret.metadata.name}${cleanHosts.length ? ` on hosts: ${cleanHosts.join(', ')}` : ''}`,
    };
}

function clone<T>(value: T): T {
    return structuredClone(value);
}

/**
 * Write a PersistentVolumeClaim reference into a workload's Pod spec:
 * `spec.volumes[].persistentVolumeClaim.claimName` under a unique volume name
 * (de-dupes existing volumes by volume name and by claim name). Deployments and
 * ReplicaSets receive the reference in `spec.template.spec` so every replica
 * mounts the claim; standalone Pods use `spec` directly.
 */
export function linkPvcToWorkload(
    resources: K8sResource[],
    pvcIdx: number,
    workloadIdx: number,
    volumeName: string
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const pvc = resources[pvcIdx];
    const workload = resources[workloadIdx];
    const claimName = pvc.metadata.name;
    const volume = volumeName.trim() || claimName;

    const patched = clone(workload);
    const spec = (patched.spec ?? {}) as Record<string, any>;
    let podSpec: Record<string, any>;
    if (patched.kind === 'CronJob') {
        spec.jobTemplate = spec.jobTemplate ?? {};
        spec.jobTemplate.spec = spec.jobTemplate.spec ?? {};
        spec.jobTemplate.spec.template = spec.jobTemplate.spec.template ?? {};
        spec.jobTemplate.spec.template.spec = spec.jobTemplate.spec.template.spec ?? {};
        podSpec = spec.jobTemplate.spec.template.spec;
    } else if (patched.kind === 'Deployment' || patched.kind === 'ReplicaSet' || patched.kind === 'Job') {
        spec.template = spec.template ?? {};
        spec.template.spec = spec.template.spec ?? {};
        podSpec = spec.template.spec;
    } else {
        podSpec = spec;
    }

    podSpec.volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes : [];
    const alreadyMounted = podSpec.volumes.some(
        (v: any) => v?.persistentVolumeClaim?.claimName === claimName
    );
    if (!alreadyMounted) {
        if (!podSpec.volumes.some((v: any) => v?.name === volume)) {
            podSpec.volumes.push({ name: volume, persistentVolumeClaim: { claimName } });
        } else {
            // Volume name is taken — fall back to a unique name derived from the claim
            let suffix = 2;
            while (podSpec.volumes.some((v: any) => v?.name === `${volume}-${suffix}`)) suffix++;
            podSpec.volumes.push({
                name: `${volume}-${suffix}`,
                persistentVolumeClaim: { claimName },
            });
        }
    }
    patched.spec = spec;
    next[workloadIdx] = patched;

    return {
        resources: next,
        description: `${patched.kind} ${workload.metadata.name} now mounts PVC ${claimName} as volume "${volume}"`,
    };
}

/**
 * Bind a PVC to a PersistentVolume by writing `spec.volumeName`. A PVC binds to
 * exactly one of PV or StorageClass, so any existing `spec.storageClassName` is
 * cleared to keep the model valid.
 */
export function linkPvcToPv(
    resources: K8sResource[],
    pvcIdx: number,
    pvIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const pv = resources[pvIdx];
    const pvc = clone(resources[pvcIdx]);
    const spec = (pvc.spec ?? {}) as Record<string, any>;
    spec.volumeName = pv.metadata.name;
    if ('storageClassName' in spec) {
        delete spec.storageClassName;
    }
    pvc.spec = spec;
    next[pvcIdx] = pvc;

    return {
        resources: next,
        description: `PVC ${pvc.metadata.name} now binds to PV ${pv.metadata.name} (volumeName set, storageClassName cleared)`,
    };
}

/**
 * Point a PVC at a StorageClass by writing `spec.storageClassName`. A PVC binds to
 * exactly one of PV or StorageClass, so any existing `spec.volumeName` is cleared
 * to keep the model valid.
 */
export function linkPvcToStorageClass(
    resources: K8sResource[],
    pvcIdx: number,
    scIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const sc = resources[scIdx];
    const pvc = clone(resources[pvcIdx]);
    const spec = (pvc.spec ?? {}) as Record<string, any>;
    spec.storageClassName = sc.metadata.name;
    if ('volumeName' in spec) {
        delete spec.volumeName;
    }
    pvc.spec = spec;
    next[pvcIdx] = pvc;

    return {
        resources: next,
        description: `PVC ${pvc.metadata.name} now provisions via StorageClass ${sc.metadata.name} (storageClassName set, volumeName cleared)`,
    };
}

/**
 * Attach a Gateway to exactly one GatewayClass by writing `spec.gatewayClassName`
 * (the class is the template a Gateway is created from — 1:1, existing value replaced).
 */
export function linkGatewayToClass(
    resources: K8sResource[],
    gatewayIdx: number,
    classIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const gatewayClass = resources[classIdx];
    const gateway = clone(resources[gatewayIdx]);
    const spec = (gateway.spec ?? {}) as Record<string, any>;
    spec.gatewayClassName = gatewayClass.metadata.name;
    gateway.spec = spec;
    next[gatewayIdx] = gateway;

    return {
        resources: next,
        description: `Gateway ${gateway.metadata.name} is now created from GatewayClass ${gatewayClass.metadata.name}`,
    };
}

/**
 * Attach a Route to a Gateway by writing `spec.parentRefs[].name`. A Route can
 * attach to more than one Gateway, so the ref is appended unless already present.
 */
export function linkRouteToGateway(
    resources: K8sResource[],
    routeIdx: number,
    gatewayIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const gateway = resources[gatewayIdx];
    const route = clone(resources[routeIdx]);
    const spec = (route.spec ?? {}) as Record<string, any>;
    const parentRefs = Array.isArray(spec.parentRefs) ? spec.parentRefs : [];
    const exists = parentRefs.some((ref: any) => ref?.name === gateway.metadata.name);
    if (!exists) {
        const ref: Record<string, any> = { name: gateway.metadata.name };
        if (gateway.metadata.namespace) ref.namespace = gateway.metadata.namespace;
        parentRefs.push(ref);
    }
    spec.parentRefs = parentRefs;
    route.spec = spec;
    next[routeIdx] = route;

    return {
        resources: next,
        description: `${route.kind} ${route.metadata.name} now attaches to Gateway ${gateway.metadata.name}`,
    };
}

/**
 * Point a Route at a Service by writing `spec.backendRefs[]` (name + the Service's
 * first port). Routes only route to Services — one Route can target several.
 */
export function linkRouteToService(
    resources: K8sResource[],
    routeIdx: number,
    serviceIdx: number
): { resources: K8sResource[]; description: string } {
    const next = [...resources];
    const service = resources[serviceIdx];
    const serviceSpec = service.spec as { ports?: Array<{ port?: unknown }> } | undefined;
    const firstPort = Array.isArray(serviceSpec?.ports) ? serviceSpec.ports[0]?.port : undefined;
    const route = clone(resources[routeIdx]);
    const spec = (route.spec ?? {}) as Record<string, any>;
    const backendRefs = Array.isArray(spec.backendRefs) ? spec.backendRefs : [];
    const exists = backendRefs.some((ref: any) => ref?.name === service.metadata.name);
    if (!exists) {
        const ref: Record<string, any> = { name: service.metadata.name };
        if (typeof firstPort === 'number') ref.port = firstPort;
        backendRefs.push(ref);
    }
    spec.backendRefs = backendRefs;
    route.spec = spec;
    next[routeIdx] = route;

    return {
        resources: next,
        description: `${route.kind} ${route.metadata.name} now routes to Service ${service.metadata.name}`,
    };
}
