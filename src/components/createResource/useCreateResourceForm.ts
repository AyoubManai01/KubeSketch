import { useEffect, useMemo, useRef, useState } from 'react';
import { getWorkloadPodLabels, parallelismOf, replicasOf, cronParallelismOf } from '../../utils/buildGraph';
import { isClusterScoped } from '../../utils/k8sScope';
import { useVeltraStore } from '../../store/store';
import { KIND_COLORS, KIND_ICONS } from '../kindMeta';
import type { SupportedKind } from '../../types/types';
import type { CreateFormBundle, CreateFormDerived, CreateFormSetters, CreateFormState } from './formTypes';

/**
 * Owns every input field of the create-resource form plus the derived memos
 * (validation, option lists and guard rails) that depend on the live canvas.
 * Returns them as a `form` bundle the section components render from.
 */
export function useCreateResourceForm(
    kind: SupportedKind,
    onClose: () => void
): CreateFormBundle & { firstInputRef: React.RefObject<HTMLInputElement | null> } {
    const nodes = useVeltraStore((s) => s.nodes);
    const nsLayout = useVeltraStore((s) => s.nsLayout);

    const suggestedName = useMemo(() => {
        const base = kind.toLowerCase();
        let idx = 1;
        while (nodes.some((n) => n.data.kind === kind && n.data.name === `${base}-${idx}`)) idx++;
        return `${base}-${idx}`;
    }, [kind, nodes]);

    const [state, setState] = useState<CreateFormState>({
        name: suggestedName,
        namespace: '',
        nsCreateOpen: false,
        appLabelDraft: '',
        appLabelTouched: false,
        replicas: '3',
        containerName: 'app',
        containerImage: 'nginx:latest',
        serviceType: 'ClusterIP',
        port: '80',
        targetPort: '8080',
        host: '',
        path: '/',
        backendService: '',
        targetWorkload: '',
        minReplicas: '1',
        maxReplicas: '10',
        cpuTarget: '70',
        vpaTarget: '',
        vpaUpdateMode: 'Auto',
        vpaMinCpu: '',
        vpaMaxCpu: '',
        vpaMinMemory: '',
        vpaMaxMemory: '',
        cmLabels: '',
        cmAnnotations: '',
        cmData: undefined,
        cmTarget: '',
        cmMechanism: 'envFrom',
        cmKey: '',
        secretLabels: '',
        secretAnnotations: '',
        secretData: undefined,
        secretTarget: '',
        secretMechanism: 'envFrom',
        secretKey: '',
        secretVolumeName: '',
        ingressTlsSecret: '',
        ingressTlsHosts: '',
        pvcAccessModes: 'ReadWriteOnce',
        pvcSize: '1Gi',
        pvcMountTarget: '',
        pvcVolumeName: '',
        pvcBindTarget: '',
        pvCapacity: '10Gi',
        pvAccessModes: 'ReadWriteOnce',
        pvReclaimPolicy: 'Retain',
        scProvisioner: 'kubernetes.io/no-provisioner',
        scReclaimPolicy: 'Delete',
        restartPolicy: 'OnFailure',
        parallelism: '1',
        completions: '1',
        schedule: '* * * * *',
        shellCommandEnabled: false,
        shellCommand: '',
        gcControllerName: 'acme.io/gateway-controller',
        gwClassName: '',
        routeParentGateway: '',
        routeBackendService: '',
        routeHostnames: '',
    });

    // One setter per field; updates are partial (the rest of the state is untouched).
    const set = useMemo(() => {
        const setters = {} as CreateFormSetters;
        (Object.keys(state) as Array<keyof CreateFormState>).forEach((key) => {
            setters[`set${key.charAt(0).toUpperCase()}${key.slice(1)}` as keyof CreateFormSetters] = (
                value: CreateFormState[typeof key]
            ) => setState((prev) => ({ ...prev, [key]: value }));
        });
        return setters;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Duplicate kind+name pairs would collide in the graph and are invalid in K8s
    const nameError = useMemo(() => {
        const trimmed = state.name.trim();
        if (!trimmed) return ''; // falls back to the suggested name
        return nodes.some((n) => n.data.kind === kind && n.data.name === trimmed)
            ? `A ${kind} named “${trimmed}” already exists.`
            : '';
    }, [state.name, kind, nodes]);

    // Namespaces are never assumed: a namespaced resource must pick, type or
    // create a namespace explicitly ("+ New" next to the field).
    const namespaceError = useMemo(() => {
        if (isClusterScoped(kind)) return '';
        return state.namespace.trim() ? '' : 'Choose or create a namespace.';
    }, [kind, state.namespace]);

    // Cron schedule validation: 5 space-separated fields (minute hour day month
    // weekday), or an @-descriptor like @hourly.
    const scheduleError = useMemo(() => {
        if (kind !== 'CronJob') return '';
        const trimmed = state.schedule.trim();
        if (!trimmed) return 'Schedule cannot be empty.';
        if (trimmed.startsWith('@')) return '';
        const parts = trimmed.split(/\s+/);
        return parts.length === 5
            ? ''
            : 'A cron schedule has 5 fields: minute hour day month weekday (e.g. "* * * * *").';
    }, [kind, state.schedule]);

    const color = KIND_COLORS[kind] ?? '#3b82f6';
    const icon = KIND_ICONS[kind];

    const isWorkload = kind === 'Deployment' || kind === 'ReplicaSet';

    // Auto-generated label follows the resource name until the user overrides it
    const appLabel = state.appLabelTouched
        ? state.appLabelDraft
        : isWorkload || kind === 'Pod' || kind === 'Job' || kind === 'CronJob'
        ? state.name.trim() || suggestedName
        : state.appLabelDraft;

    const serviceOptions = useMemo(
        () => nodes.filter((n) => n.data.kind === 'Service').map((n) => n.data.name as string),
        [nodes]
    );

    // Gateway API: existing GatewayClasses (for a standalone Gateway's gatewayClassName)
    // and existing Gateways (for a standalone Route's parentRefs)
    const gatewayClassOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'GatewayClass')
                .map((n) => n.data.name as string)
                .sort((a, b) => a.localeCompare(b)),
        [nodes]
    );
    const gatewayOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'Gateway')
                .map((n) => n.data.name as string)
                .sort((a, b) => a.localeCompare(b)),
        [nodes]
    );

    // HorizontalPodAutoscaler scale targets: Deployments and ReplicaSets on the canvas
    const workloadOptions = useMemo(
        () =>
            nodes
                .filter(
                    (n) =>
                        n.data.kind === 'Deployment' ||
                        n.data.kind === 'ReplicaSet'
                )
                .map((n) => ({ kind: n.data.kind as string, name: n.data.name as string }))
                .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
        [nodes]
    );

    // VPA targetRef candidates: every real pod-bearing resource on the canvas
    // (synthetic nodes are excluded; a targetRef points at a manifest resource).
    const vpaTargetOptions = useMemo(
        () =>
            nodes
                .filter(
                    (n) =>
                        !n.data.synthetic &&
                        (n.data.kind === 'Deployment' ||
                            n.data.kind === 'ReplicaSet' ||
                            n.data.kind === 'Pod' ||
                            n.data.kind === 'Job' ||
                            n.data.kind === 'CronJob')
                )
                .map((n) => ({ kind: n.data.kind as string, name: n.data.name as string }))
                .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
        [nodes]
    );

    // Existing selectable targets: app-label values with the real resources carrying them
    const workloadTargets = useMemo(() => {
        const owners = new Map<string, string[]>();
        nodes.forEach((n) => {
            if (n.data.synthetic) return;
            const k = n.data.kind;
            let value: string | undefined;
            if (k === 'Deployment' || k === 'ReplicaSet' || k === 'Job' || k === 'CronJob') {
                value = getWorkloadPodLabels(n.data.resource)?.app;
            } else if (k === 'Pod') {
                value = n.data.resource.metadata?.labels?.app;
            }
            if (!value) return;
            const list = owners.get(value) ?? [];
            list.push(`${k} ${n.data.name}`);
            owners.set(value, list);
        });
        return Array.from(owners.entries()).map(([value, list]) => ({ value, owners: list.join(', ') }));
    }, [nodes]);

    const namespaceOptions = useMemo(() => {
        const vals = new Set<string>();
        nodes.forEach((n) => { if (n.data.namespace) vals.add(n.data.namespace); });
        nsLayout?.namespaces?.forEach((ns) => vals.add(ns.name));
        return Array.from(vals).sort();
    }, [nodes, nsLayout]);

    // Link targets for a new ConfigMap: real Deployments/ReplicaSets/standalone Pods,
    // plus controller-materialized Pods (their ref is written to the real owner's pod
    // template). De-duped by the resolved real owner, so several synthetic Pods of the
    // same workload collapse into one option.
    const cmTargetOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ label: string; value: string }> = [];
        nodes.forEach((n) => {
            const k = n.data.kind;
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
            let realKind: string = k;
            let realName: string = n.data.name;
            let label = `${k} ${n.data.name}`;
            if (n.data.synthetic && n.data.managedBy) {
                realKind = n.data.managedBy.kind;
                realName = n.data.managedBy.name;
                label = `${k} ${n.data.name} (via ${n.data.managedBy.kind} ${n.data.managedBy.name})`;
            }
            const value = `${realKind}|${realName}`;
            if (seen.has(value)) return;
            seen.add(value);
            options.push({ label, value });
        });
        return options.sort((a, b) => a.label.localeCompare(b.label));
    }, [nodes]);

    const cmDataKeys = useMemo(() => Object.keys(state.cmData ?? {}), [state.cmData]);

    // Link targets for a new Secret (same resolution as ConfigMap targets): real
    // Deployments/ReplicaSets/standalone Pods, synthetic Pods resolve to their owner.
    const secretTargetOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ label: string; value: string }> = [];
        nodes.forEach((n) => {
            const k = n.data.kind;
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
            let realKind: string = k;
            let realName: string = n.data.name;
            let label = `${k} ${n.data.name}`;
            if (n.data.synthetic && n.data.managedBy) {
                realKind = n.data.managedBy.kind;
                realName = n.data.managedBy.name;
                label = `${k} ${n.data.name} (via ${n.data.managedBy.kind} ${n.data.managedBy.name})`;
            }
            const value = `${realKind}|${realName}`;
            if (seen.has(value)) return;
            seen.add(value);
            options.push({ label, value });
        });
        return options.sort((a, b) => a.label.localeCompare(b.label));
    }, [nodes]);

    const secretDataKeys = useMemo(() => Object.keys(state.secretData ?? {}), [state.secretData]);

    // TLS secrets for a new Ingress: real Secrets on the canvas.
    const ingressTlsSecretOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'Secret')
                .map((n) => n.data.name as string)
                .sort((a, b) => a.localeCompare(b)),
        [nodes]
    );

    // PVC mount targets: real Pods, Deployments and ReplicaSets (synthetic Pods
    // resolve to their real workload owner; the claim goes into the owner's Pod
    // template). De-duped by the resolved real owner, so several synthetic Pods
    // of the same workload collapse into one option.
    const pvcMountOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ label: string; value: string }> = [];
        nodes.forEach((n) => {
            const k = n.data.kind;
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
            let realKind: string = k;
            let realName: string = n.data.name;
            let label = `${k} ${n.data.name}`;
            if (n.data.synthetic && n.data.managedBy) {
                realKind = n.data.managedBy.kind;
                realName = n.data.managedBy.name;
                label = `${k} ${n.data.name} (via ${n.data.managedBy.kind} ${n.data.managedBy.name})`;
            }
            const value = `${realKind}|${realName}`;
            if (seen.has(value)) return;
            seen.add(value);
            options.push({ label, value });
        });
        return options.sort((a, b) => a.label.localeCompare(b.label));
    }, [nodes]);

    // Single-node access-mode guard: a workload running more than one replica cannot
    // mount a ReadWriteOnce/ReadWriteOncePod claim: identical Pods would all claim
    // the same volume, and only one node may attach it.
    const pvcMountReplicasError = useMemo(() => {
        if (kind !== 'PersistentVolumeClaim' || !state.pvcMountTarget) return null;
        if (state.pvcAccessModes !== 'ReadWriteOnce' && state.pvcAccessModes !== 'ReadWriteOncePod') {
            return null;
        }
        const [targetKind, targetName] = state.pvcMountTarget.split('|');
        if (targetKind === 'Pod') return null;
        const target = nodes.find(
            (n) => n.data.kind === targetKind && n.data.name === targetName
        );
        if (!target) return null;
        if (targetKind === 'Job') {
            const parallelism = parallelismOf(target.data.resource);
            if (parallelism <= 1) return null;
            return `Job ${targetName} runs ${parallelism} pods in parallel: a ${state.pvcAccessModes} PVC can only attach to one node. Reduce parallelism to 1 or pick ReadOnlyMany/ReadWriteMany.`;
        }
        if (targetKind === 'CronJob') {
            const parallelism = cronParallelismOf(target.data.resource);
            if (parallelism <= 1) return null;
            return `CronJob ${targetName} runs ${parallelism} pods in parallel: a ${state.pvcAccessModes} PVC can only attach to one node. Reduce parallelism to 1 or pick ReadOnlyMany/ReadWriteMany.`;
        }
        const replicas = replicasOf(target.data.resource);
        if (replicas <= 1) return null;
        return `${targetKind} ${targetName} runs ${replicas} replicas: a ${state.pvcAccessModes} PVC can only attach to one node. Scale down to 1 or pick ReadOnlyMany/ReadWriteMany.`;
    }, [kind, state.pvcMountTarget, state.pvcAccessModes, nodes]);

    const pvOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'PersistentVolume')
                .map((n) => ({ name: n.data.name as string, bound: (n.data.resource.spec as any)?.claimRef?.name as string | undefined })),
        [nodes]
    );

    const storageClassOptions = useMemo(
        () =>
            nodes
                .filter((n) => n.data.kind === 'StorageClass')
                .map((n) => n.data.name as string)
                .sort((a, b) => a.localeCompare(b)),
        [nodes]
    );

    const firstInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        firstInputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const derived: CreateFormDerived = {
        suggestedName,
        nameError,
        namespaceError,
        scheduleError,
        appLabel,
        color,
        icon,
        isWorkload,
        serviceOptions,
        gatewayClassOptions,
        gatewayOptions,
        workloadOptions,
        vpaTargetOptions,
        workloadTargets,
        namespaceOptions,
        cmTargetOptions,
        cmDataKeys,
        secretTargetOptions,
        secretDataKeys,
        ingressTlsSecretOptions,
        pvcMountOptions,
        pvcMountReplicasError,
        pvOptions,
        storageClassOptions,
    };

    return { state, set, derived, firstInputRef };
}