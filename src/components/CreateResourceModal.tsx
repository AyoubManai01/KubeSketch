import { useEffect, useMemo, useRef, useState } from 'react';
import type { K8sResource, SupportedKind } from '../types/types';
import { getWorkloadPodLabels, parallelismOf, replicasOf, cronParallelismOf } from '../utils/buildGraph';
import { isClusterScoped } from '../utils/k8sScope';
import type { ConfigMapMechanism, SecretMechanism } from '../utils/linkResources';
import {
    useVeltraStore,
    type ConfigMapLinkPayload,
    type PvcLinkPayload,
    type SecretLinkPayload,
    type IngressTlsPayload,
} from '../store/store';
import ConfigMapDataEditor from './ConfigMapDataEditor';
import NamespaceField from './NamespaceField';

interface Props {
    kind: SupportedKind;
    onClose: () => void;
}

const KIND_COLORS: Record<string, string> = {
    Deployment: '#10b981',
    DaemonSet: '#a855f7',
    StatefulSet: '#059669',
    ReplicaSet: '#f97316',
    Pod: '#14b8a6',
    Service: '#3b82f6',
    Ingress: '#8b5cf6',
    HorizontalPodAutoscaler: '#f59e0b',
    ConfigMap: '#06b6d4',
    PersistentVolumeClaim: '#ec4899',
    PersistentVolume: '#84cc16',
    StorageClass: '#6366f1',
    Secret: '#dc2626',
    Job: '#eab308',
    CronJob: '#d946ef',
    VerticalPodAutoscaler: '#0ea5e9',
    GatewayClass: '#f43f5e',
    Gateway: '#7c3aed',
    HTTPRoute: '#0d9488',
    GRPCRoute: '#65a30d',
    TCPRoute: '#0284c7',
    TLSRoute: '#d97706',
    UDPRoute: '#16a34a',
};

const KIND_ICONS: Record<string, React.ReactNode> = {
    Deployment: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="8" height="8" rx="1.5" />
            <rect x="14" y="2" width="8" height="8" rx="1.5" />
            <rect x="2" y="14" width="8" height="8" rx="1.5" />
            <path d="M6 10v4M10 6h4M14 18h4" strokeDasharray="2 2" />
        </svg>
    ),
    ReplicaSet: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="10" height="10" rx="2" />
            <rect x="11" y="11" width="10" height="10" rx="2" strokeDasharray="2 2" />
            <path d="M13 8h3v3" strokeDasharray="2 2" />
        </svg>
    ),
    DaemonSet: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <circle cx="7" cy="12" r="2.5" />
            <circle cx="12" cy="16" r="2.5" />
            <circle cx="17" cy="12" r="2.5" />
        </svg>
    ),
    StatefulSet: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="8" rx="2" />
            <path d="M7 3v8M12 3v8M17 3v8" />
            <rect x="3" y="13" width="18" height="8" rx="2" />
            <path d="M7 13v8M12 13v8M17 13v8" />
        </svg>
    ),
    Pod: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
        </svg>
    ),
    Service: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 4h-4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2V6a2 2 0 00-2-2z" />
            <path d="M8 13H4a2 2 0 00-2 2v3a2 2 0 002 2h4a2 2 0 002-2v-3a2 2 0 00-2-2z" />
            <path d="M9 8v5M15 15v-5M12 5v14" strokeDasharray="2 2" />
        </svg>
    ),
    Ingress: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
    ),
    HorizontalPodAutoscaler: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20V10M12 6V4" />
            <path d="M12 16l3-3-3-3-3 3 3 3z" />
            <path d="M5 6a7 7 0 0014 0" />
        </svg>
    ),
    ConfigMap: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16v12H4z" />
            <path d="M8 10h8M8 14h5" />
        </svg>
    ),
    PersistentVolumeClaim: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
        </svg>
    ),
    PersistentVolume: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
    ),
    StorageClass: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="6" rx="2" />
            <rect x="3" y="14" width="18" height="6" rx="2" />
            <path d="M7 10v4M17 10v4" strokeDasharray="2 2" />
        </svg>
    ),
    Secret: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
            <circle cx="12" cy="15.5" r="1.5" />
        </svg>
    ),
    Job: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M8 2v4M16 2v4M3 9h18" />
            <path d="M9 14l2 2 4-4" />
        </svg>
    ),
    CronJob: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
            <path d="M12 4v3M12 17v3" />
        </svg>
    ),
    VerticalPodAutoscaler: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="12" width="4" height="8" rx="1" />
            <rect x="10" y="8" width="4" height="12" rx="1" />
            <rect x="16" y="4" width="4" height="16" rx="1" />
            <path d="M5 12V9M11 8V5M17 4V7" strokeDasharray="2 2" />
        </svg>
    ),
    GatewayClass: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 9h18" />
            <circle cx="7" cy="16" r="1" />
            <circle cx="12" cy="16" r="1" />
            <circle cx="17" cy="16" r="1" />
        </svg>
    ),
    Gateway: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h18v10H3z" />
            <path d="M8 10h4v4H8z" />
            <path d="M14.5 10h2.5v4h-2.5" />
        </svg>
    ),
    HTTPRoute: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5" />
            <path d="M4 5l16 6-16 6" />
            <path d="M13 5h7v4" />
        </svg>
    ),
    GRPCRoute: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5" />
            <path d="M4 5l16 6-16 6" />
            <path d="M15 4.5l4.5 1.5L15 7.5" />
            <path d="M15 16.5l4.5 1.5-4.5 1.5" />
        </svg>
    ),
    TCPRoute: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5" />
            <path d="M4 5l16 6-16 6" />
            <circle cx="18" cy="18" r="3" />
        </svg>
    ),
    TLSRoute: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5" />
            <path d="M4 5l16 6-16 6" />
            <rect x="14" y="12" width="8" height="6" rx="1" />
            <path d="M16 12v-1a2 2 0 014 0v1" />
        </svg>
    ),
    UDPRoute: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V5" />
            <path d="M4 5l16 6-16 6" />
            <circle cx="19" cy="18" r="2" />
            <path d="M19 8v6" strokeDasharray="2 2" />
        </svg>
    ),
};

function hexToRgba(hex: string, alpha: number): string {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!r) return `rgba(59,130,246,${alpha})`;
    return `rgba(${parseInt(r[1], 16)},${parseInt(r[2], 16)},${parseInt(r[3], 16)},${alpha})`;
}

export default function CreateResourceModal({ kind, onClose }: Props) {
    const nodes = useVeltraStore((s) => s.nodes);
    const addConfiguredNode = useVeltraStore((s) => s.addConfiguredNode);
    const addConfiguredNodes = useVeltraStore((s) => s.addConfiguredNodes);
    const nsLayout = useVeltraStore((s) => s.nsLayout);

    const suggestedName = useMemo(() => {
        const base = kind.toLowerCase();
        let idx = 1;
        while (nodes.some((n) => n.data.kind === kind && n.data.name === `${base}-${idx}`)) idx++;
        return `${base}-${idx}`;
    }, [kind, nodes]);

    const [name, setName] = useState(suggestedName);

    // Duplicate kind+name pairs would collide in the graph and are invalid in K8s
    const nameError = useMemo(() => {
        const trimmed = name.trim();
        if (!trimmed) return ''; // falls back to the suggested name
        return nodes.some((n) => n.data.kind === kind && n.data.name === trimmed)
            ? `A ${kind} named “${trimmed}” already exists.`
            : '';
    }, [name, kind, nodes]);

    const [namespace, setNamespace] = useState('default');
    // Workloads/Pods auto-derive their app label from the name until the user edits it
    const [appLabelDraft, setAppLabelDraft] = useState('');
    const [appLabelTouched, setAppLabelTouched] = useState(false);
    const [replicas, setReplicas] = useState('3');
    const [containerName, setContainerName] = useState('app');
    const [containerImage, setContainerImage] = useState('nginx:latest');
    const [serviceType, setServiceType] = useState('ClusterIP');
    const [port, setPort] = useState('80');
    const [targetPort, setTargetPort] = useState('8080');
    const [host, setHost] = useState('');
    const [path, setPath] = useState('/');
    const [backendService, setBackendService] = useState('');
    const [targetWorkload, setTargetWorkload] = useState('');
    const [minReplicas, setMinReplicas] = useState('1');
    const [maxReplicas, setMaxReplicas] = useState('10');
    const [cpuTarget, setCpuTarget] = useState('70');
    // VPA fields
    const [vpaTarget, setVpaTarget] = useState('');
    const [vpaUpdateMode, setVpaUpdateMode] = useState('Auto');
    const [vpaMinCpu, setVpaMinCpu] = useState('');
    const [vpaMaxCpu, setVpaMaxCpu] = useState('');
    const [vpaMinMemory, setVpaMinMemory] = useState('');
    const [vpaMaxMemory, setVpaMaxMemory] = useState('');
    const [cmLabels, setCmLabels] = useState('');
    const [cmAnnotations, setCmAnnotations] = useState('');
    const [cmData, setCmData] = useState<Record<string, string> | undefined>(undefined);
    const [cmTarget, setCmTarget] = useState('');
    const [cmMechanism, setCmMechanism] = useState<ConfigMapMechanism>('envFrom');
    const [cmKey, setCmKey] = useState('');
    // Secret: labels/annotations/data + link fields
    const [secretLabels, setSecretLabels] = useState('');
    const [secretAnnotations, setSecretAnnotations] = useState('');
    const [secretData, setSecretData] = useState<Record<string, string> | undefined>(undefined);
    const [secretTarget, setSecretTarget] = useState('');
    const [secretMechanism, setSecretMechanism] = useState<SecretMechanism>('envFrom');
    const [secretKey, setSecretKey] = useState('');
    const [secretVolumeName, setSecretVolumeName] = useState('');
    // Ingress: TLS picker
    const [ingressTlsSecret, setIngressTlsSecret] = useState('');
    const [ingressTlsHosts, setIngressTlsHosts] = useState('');
    // PVC: claim + binding fields
    const [pvcAccessModes, setPvcAccessModes] = useState('ReadWriteOnce');
    const [pvcSize, setPvcSize] = useState('1Gi');
    const [pvcMountTarget, setPvcMountTarget] = useState('');
    const [pvcVolumeName, setPvcVolumeName] = useState('');
    const [pvcBindTarget, setPvcBindTarget] = useState('');
    // PV fields
    const [pvCapacity, setPvCapacity] = useState('10Gi');
    const [pvAccessModes, setPvAccessModes] = useState('ReadWriteOnce');
    const [pvReclaimPolicy, setPvReclaimPolicy] = useState('Retain');
    // StorageClass fields
    const [scProvisioner, setScProvisioner] = useState('kubernetes.io/no-provisioner');
    const [scReclaimPolicy, setScReclaimPolicy] = useState('Delete');
    // Job fields
    const [restartPolicy, setRestartPolicy] = useState('OnFailure');
    const [parallelism, setParallelism] = useState('1');
    const [completions, setCompletions] = useState('1');
    // DaemonSet fields
    const [desiredNodes, setDesiredNodes] = useState('3');
    // StatefulSet fields: optional volumeClaimTemplates (one template → one PVC)
    const [stsVolumeClaims, setStsVolumeClaims] = useState(false);
    const [stsClaimName, setStsClaimName] = useState('data');
    const [stsClaimSize, setStsClaimSize] = useState('1Gi');
    const [stsClaimAccessMode, setStsClaimAccessMode] = useState('ReadWriteOnce');
    // CronJob fields
    const [schedule, setSchedule] = useState('* * * * *');
    const [shellCommandEnabled, setShellCommandEnabled] = useState(false);
    const [shellCommand, setShellCommand] = useState('');
    // GatewayClass fields
    const [gcControllerName, setGcControllerName] = useState('acme.io/gateway-controller');
    // Gateway fields
    const [gwClassName, setGwClassName] = useState('');
    // Route fields (shared by HTTPRoute/GRPCRoute/TCPRoute/TLSRoute)
    const [routeParentGateway, setRouteParentGateway] = useState('');
    const [routeBackendService, setRouteBackendService] = useState('');
    const [routeHostnames, setRouteHostnames] = useState('');

    // Cron schedule validation: 5 space-separated fields (minute hour day month
    // weekday), or an @-descriptor like @hourly.
    const scheduleError = useMemo(() => {
        if (kind !== 'CronJob') return '';
        const trimmed = schedule.trim();
        if (!trimmed) return 'Schedule cannot be empty.';
        if (trimmed.startsWith('@')) return '';
        const parts = trimmed.split(/\s+/);
        return parts.length === 5
            ? ''
            : 'A cron schedule has 5 fields: minute hour day month weekday (e.g. "* * * * *").';
    }, [kind, schedule]);

    const firstInputRef = useRef<HTMLInputElement>(null);

    // DaemonSet cluster node count: a whole number of at least 1 (the desired
    // TOTAL node rects — existing ones count toward it).
    const daemonSetNodesError =
        kind === 'DaemonSet'
            ? /^\d+$/.test(desiredNodes.trim()) && parseInt(desiredNodes, 10) >= 1
                ? ''
                : 'Nodes must be a whole number of at least 1.'
            : '';

    // StatefulSet volume claim template: a name is required when enabled, and
    // the generated PVC must not collide with an existing claim on the canvas.
    const stsClaimNameError =
        kind === 'StatefulSet' && stsVolumeClaims
            ? !stsClaimName.trim()
                ? 'The volume claim template needs a name.'
                : nodes.some(
                      (n) =>
                          n.data.kind === 'PersistentVolumeClaim' &&
                          n.data.name === stsClaimName.trim()
                  )
                ? `A PersistentVolumeClaim named “${stsClaimName.trim()}” already exists.`
                : ''
            : '';

    const color = KIND_COLORS[kind] ?? '#3b82f6';
    const icon = KIND_ICONS[kind];

    const isWorkload = kind === 'Deployment' || kind === 'ReplicaSet' || kind === 'StatefulSet';

    // Auto-generated label follows the resource name until the user overrides it
    const appLabel = appLabelTouched
        ? appLabelDraft
        : isWorkload || kind === 'Pod' || kind === 'Job' || kind === 'CronJob' || kind === 'DaemonSet'
        ? name.trim() || suggestedName
        : appLabelDraft;

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

    // HorizontalPodAutoscaler scale targets: Deployments, ReplicaSets and StatefulSets on the canvas
    const workloadOptions = useMemo(
        () =>
            nodes
                .filter(
                    (n) =>
                        n.data.kind === 'Deployment' ||
                        n.data.kind === 'ReplicaSet' ||
                        n.data.kind === 'StatefulSet'
                )
                .map((n) => ({ kind: n.data.kind as string, name: n.data.name as string }))
                .sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
        [nodes]
    );

    // VPA targetRef candidates: every real pod-bearing resource on the canvas
    // (synthetic nodes are excluded — a targetRef points at a manifest resource).
    const vpaTargetOptions = useMemo(
        () =>
            nodes
                .filter(
                    (n) =>
                        !n.data.synthetic &&
                        (n.data.kind === 'Deployment' ||
                            n.data.kind === 'DaemonSet' ||
                            n.data.kind === 'StatefulSet' ||
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
            if (k === 'Deployment' || k === 'DaemonSet' || k === 'StatefulSet' || k === 'ReplicaSet' || k === 'Job' || k === 'CronJob') {
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
        const vals = new Set<string>(['default']);
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
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'DaemonSet' && k !== 'StatefulSet' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
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

    const cmDataKeys = useMemo(() => Object.keys(cmData ?? {}), [cmData]);

    // Link targets for a new Secret: same resolution as ConfigMap targets — real
    // Deployments/ReplicaSets/standalone Pods, synthetic Pods resolve to their owner.
    const secretTargetOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ label: string; value: string }> = [];
        nodes.forEach((n) => {
            const k = n.data.kind;
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'DaemonSet' && k !== 'StatefulSet' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
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

    const secretDataKeys = useMemo(() => Object.keys(secretData ?? {}), [secretData]);

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
    // resolve to their real workload owner — the claim goes into the owner's Pod
    // template). De-duped by the resolved real owner, so several synthetic Pods
    // of the same workload collapse into one option.
    const pvcMountOptions = useMemo(() => {
        const seen = new Set<string>();
        const options: Array<{ label: string; value: string }> = [];
        nodes.forEach((n) => {
            const k = n.data.kind;
            if (k !== 'Pod' && k !== 'Deployment' && k !== 'DaemonSet' && k !== 'StatefulSet' && k !== 'ReplicaSet' && k !== 'Job' && k !== 'CronJob') return;
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
    // mount a ReadWriteOnce/ReadWriteOncePod claim — identical Pods would all claim
    // the same volume, and only one node may attach it.
    const pvcMountReplicasError = useMemo(() => {
        if (kind !== 'PersistentVolumeClaim' || !pvcMountTarget) return null;
        if (pvcAccessModes !== 'ReadWriteOnce' && pvcAccessModes !== 'ReadWriteOncePod') {
            return null;
        }
        const [targetKind, targetName] = pvcMountTarget.split('|');
        if (targetKind === 'Pod') return null;
        const target = nodes.find(
            (n) => n.data.kind === targetKind && n.data.name === targetName
        );
        if (!target) return null;
        if (targetKind === 'Job') {
            const parallelism = parallelismOf(target.data.resource);
            if (parallelism <= 1) return null;
            return `Job ${targetName} runs ${parallelism} pods in parallel — a ${pvcAccessModes} PVC can only attach to one node. Reduce parallelism to 1 or pick ReadOnlyMany/ReadWriteMany.`;
        }
        if (targetKind === 'CronJob') {
            const parallelism = cronParallelismOf(target.data.resource);
            if (parallelism <= 1) return null;
            return `CronJob ${targetName} runs ${parallelism} pods in parallel — a ${pvcAccessModes} PVC can only attach to one node. Reduce parallelism to 1 or pick ReadOnlyMany/ReadWriteMany.`;
        }
        const replicas = replicasOf(target.data.resource);
        if (replicas <= 1) return null;
        return `${targetKind} ${targetName} runs ${replicas} replicas — a ${pvcAccessModes} PVC can only attach to one node. Scale down to 1 or pick ReadOnlyMany/ReadWriteMany.`;
    }, [kind, pvcMountTarget, pvcAccessModes, nodes]);

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

    useEffect(() => {
        firstInputRef.current?.focus();
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    function buildResource(): K8sResource {
        const meta: K8sResource['metadata'] = {
            name: name.trim() || suggestedName,
            namespace: namespace || 'default',
        };
        if (appLabel.trim()) meta.labels = { app: appLabel.trim() };

        switch (kind) {
            case 'Deployment':
            case 'ReplicaSet': {
                const replicaNum = parseInt(replicas, 10);
                const label = appLabel.trim() || meta.name;
                return {
                    apiVersion: 'apps/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec: {
                        replicas: Number.isFinite(replicaNum) ? replicaNum : 1,
                        selector: { matchLabels: { app: label } },
                        template: {
                            metadata: { labels: { app: label } },
                            spec: {
                                containers: [{ name: 'app', image: 'nginx:latest' }],
                            },
                        },
                    },
                };
            }
            case 'DaemonSet': {
                const label = appLabel.trim() || meta.name;
                return {
                    apiVersion: 'apps/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec: {
                        selector: { matchLabels: { app: label } },
                        template: {
                            metadata: { labels: { app: label } },
                            spec: {
                                containers: [
                                    {
                                        name: containerName.trim() || 'app',
                                        image: containerImage.trim() || 'nginx:latest',
                                    },
                                ],
                            },
                        },
                    },
                };
            }
            case 'StatefulSet': {
                const replicaNum = parseInt(replicas, 10);
                const label = appLabel.trim() || meta.name;
                const spec: Record<string, unknown> = {
                    replicas: Number.isFinite(replicaNum) ? replicaNum : 1,
                    selector: { matchLabels: { app: label } },
                    template: {
                        metadata: { labels: { app: label } },
                        spec: {
                            containers: [
                                {
                                    name: containerName.trim() || 'app',
                                    image: containerImage.trim() || 'nginx:latest',
                                },
                            ],
                        },
                    },
                };
                if (stsVolumeClaims) {
                    spec.volumeClaimTemplates = [
                        {
                            metadata: { name: stsClaimName.trim() },
                            spec: {
                                accessModes: [stsClaimAccessMode],
                                resources: {
                                    requests: { storage: stsClaimSize.trim() || '1Gi' },
                                },
                            },
                        },
                    ];
                }
                return {
                    apiVersion: 'apps/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec,
                };
            }
            case 'Pod':
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: meta,
                    spec: {
                        containers: [
                            {
                                name: containerName.trim() || 'app',
                                image: containerImage.trim() || 'nginx:latest',
                            },
                        ],
                    },
                };
            case 'Service': {
                const portNum = parseInt(port, 10);
                const tpNum = parseInt(targetPort, 10);
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        type: serviceType || 'ClusterIP',
                        ...(appLabel.trim() ? { selector: { app: appLabel.trim() } } : {}),
                        ports: [
                            {
                                port: Number.isFinite(portNum) ? portNum : 80,
                                targetPort: Number.isFinite(tpNum) ? tpNum : 8080,
                            },
                        ],
                    },
                };
            }
            case 'Ingress':
                return {
                    apiVersion: 'networking.k8s.io/v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        rules: [
                            {
                                ...(host.trim() ? { host: host.trim() } : {}),
                                http: {
                                    paths: [
                                        {
                                            path: path.trim() || '/',
                                            pathType: 'Prefix',
                                            ...(backendService
                                                ? {
                                                      backend: {
                                                          service: {
                                                              name: backendService,
                                                              port: { number: 80 },
                                                          },
                                                      },
                                                  }
                                                : {}),
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                };
            case 'HorizontalPodAutoscaler': {
                const minNum = parseInt(minReplicas, 10);
                const maxNum = parseInt(maxReplicas, 10);
                const cpuNum = parseInt(cpuTarget, 10);
                const [targetKindRaw, targetNameRaw] = targetWorkload.split('|');
                const fallback = workloadOptions[0];
                const targetKind = targetKindRaw || fallback?.kind || 'Deployment';
                const targetName = targetNameRaw || fallback?.name || '';
                return {
                    apiVersion: 'autoscaling/v2',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        scaleTargetRef: {
                            apiVersion: 'apps/v1',
                            kind: targetKind,
                            name: targetName,
                        },
                        minReplicas: Number.isFinite(minNum) ? minNum : 1,
                        maxReplicas: Number.isFinite(maxNum) ? maxNum : 10,
                        metrics: [
                            {
                                type: 'Resource',
                                resource: {
                                    name: 'cpu',
                                    target: {
                                        type: 'Utilization',
                                        averageUtilization: Number.isFinite(cpuNum) ? cpuNum : 70,
                                    },
                                },
                            },
                        ],
                    },
                };
            }
            case 'ConfigMap': {
                const labels = parseKeyValueString(cmLabels);
                const annotations = parseKeyValueString(cmAnnotations);
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: {
                        name: meta.name,
                        namespace: meta.namespace,
                        ...(labels ? { labels } : {}),
                        ...(annotations ? { annotations } : {}),
                    },
                    ...(cmData ? { data: cmData } : {}),
                };
            }
            case 'Secret': {
                const labels = parseKeyValueString(secretLabels);
                const annotations = parseKeyValueString(secretAnnotations);
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: {
                        name: meta.name,
                        namespace: meta.namespace,
                        ...(labels ? { labels } : {}),
                        ...(annotations ? { annotations } : {}),
                    },
                    ...(secretData ? { data: secretData } : {}),
                };
            }
            case 'PersistentVolumeClaim': {
                return {
                    apiVersion: 'v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        accessModes: [pvcAccessModes],
                        resources: { requests: { storage: pvcSize.trim() || '1Gi' } },
                    },
                };
            }
            case 'PersistentVolume':
                return {
                    apiVersion: 'v1',
                    kind,
                    // PVs are cluster-scoped — no namespace field.
                    metadata: { name: meta.name },
                    spec: {
                        capacity: { storage: pvCapacity.trim() || '10Gi' },
                        accessModes: [pvAccessModes],
                        persistentVolumeReclaimPolicy: pvReclaimPolicy,
                    },
                };
            case 'StorageClass':
                return {
                    apiVersion: 'storage.k8s.io/v1',
                    kind,
                    // StorageClasses are cluster-scoped — no namespace field.
                    metadata: { name: meta.name },
                    spec: {
                        provisioner: scProvisioner.trim() || 'kubernetes.io/no-provisioner',
                        ...(scReclaimPolicy ? { reclaimPolicy: scReclaimPolicy } : {}),
                    },
                };
            case 'Job': {
                const parallelismNum = parseInt(parallelism, 10);
                const completionsNum = parseInt(completions, 10);
                const label = appLabel.trim() || meta.name;
                return {
                    apiVersion: 'batch/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec: {
                        parallelism:
                            Number.isFinite(parallelismNum) && parallelismNum > 0 ? parallelismNum : 1,
                        completions:
                            Number.isFinite(completionsNum) && completionsNum > 0 ? completionsNum : 1,
                        selector: { matchLabels: { app: label } },
                        template: {
                            metadata: { labels: { app: label } },
                            spec: {
                                restartPolicy: restartPolicy || 'OnFailure',
                                containers: [
                                    {
                                        name: containerName.trim() || 'app',
                                        image: containerImage.trim() || 'nginx:latest',
                                    },
                                ],
                            },
                        },
                    },
                };
            }
            case 'CronJob': {
                const parallelismNum = parseInt(parallelism, 10);
                const completionsNum = parseInt(completions, 10);
                const label = appLabel.trim() || meta.name;
                const shellCmd = shellCommand.trim();
                return {
                    apiVersion: 'batch/v1',
                    kind,
                    metadata: { ...meta, labels: { app: label } },
                    spec: {
                        schedule: schedule.trim() || '* * * * *',
                        jobTemplate: {
                            spec: {
                                parallelism:
                                    Number.isFinite(parallelismNum) && parallelismNum > 0
                                        ? parallelismNum
                                        : 1,
                                completions:
                                    Number.isFinite(completionsNum) && completionsNum > 0
                                        ? completionsNum
                                        : 1,
                                selector: { matchLabels: { app: label } },
                                template: {
                                    metadata: { labels: { app: label } },
                                    spec: {
                                        restartPolicy: restartPolicy || 'OnFailure',
                                        containers: [
                                            {
                                                name: containerName.trim() || 'app',
                                                image: containerImage.trim() || 'nginx:latest',
                                                ...(shellCommandEnabled && shellCmd
                                                    ? { command: ['/bin/sh', '-c'], args: [shellCmd] }
                                                    : {}),
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                };
            }
            case 'VerticalPodAutoscaler': {
                const [targetKindRaw, targetNameRaw] = vpaTarget.split('|');
                const fallback = vpaTargetOptions[0];
                const targetKind = targetKindRaw || fallback?.kind || 'Deployment';
                const targetName = targetNameRaw || fallback?.name || '';
                const targetApiVersion =
                    targetKind === 'Deployment' || targetKind === 'DaemonSet' || targetKind === 'StatefulSet' || targetKind === 'ReplicaSet'
                        ? 'apps/v1'
                        : targetKind === 'Job' || targetKind === 'CronJob'
                        ? 'batch/v1'
                        : 'v1';
                const minAllowed: Record<string, string> = {};
                const maxAllowed: Record<string, string> = {};
                if (vpaMinCpu.trim()) minAllowed.cpu = vpaMinCpu.trim();
                if (vpaMinMemory.trim()) minAllowed.memory = vpaMinMemory.trim();
                if (vpaMaxCpu.trim()) maxAllowed.cpu = vpaMaxCpu.trim();
                if (vpaMaxMemory.trim()) maxAllowed.memory = vpaMaxMemory.trim();
                const hasBounds =
                    Object.keys(minAllowed).length > 0 || Object.keys(maxAllowed).length > 0;
                return {
                    apiVersion: 'autoscaling.k8s.io/v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        targetRef: {
                            apiVersion: targetApiVersion,
                            kind: targetKind,
                            name: targetName,
                        },
                        updatePolicy: { updateMode: vpaUpdateMode },
                        ...(hasBounds
                            ? {
                                  resourcePolicy: {
                                      containerPolicies: [
                                          {
                                              containerName: '*',
                                              ...(Object.keys(minAllowed).length
                                                  ? { minAllowed }
                                                  : {}),
                                              ...(Object.keys(maxAllowed).length
                                                  ? { maxAllowed }
                                                  : {}),
                                          },
                                      ],
                                  },
                              }
                            : {}),
                    },
                };
            }
            case 'GatewayClass':
                return {
                    apiVersion: 'gateway.networking.k8s.io/v1',
                    kind,
                    // GatewayClasses are cluster-scoped — no namespace field.
                    metadata: { name: meta.name },
                    spec: {
                        controllerName:
                            gcControllerName.trim() || 'acme.io/gateway-controller',
                    },
                };
            case 'Gateway':
                return {
                    apiVersion: 'gateway.networking.k8s.io/v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec: {
                        ...(gwClassName
                            ? { gatewayClassName: gwClassName }
                            : { gatewayClassName: '' }),
                        listeners: [],
                    },
                };
            case 'HTTPRoute':
            case 'GRPCRoute':
            case 'TCPRoute':
            case 'TLSRoute':
            case 'UDPRoute': {
                const spec: Record<string, unknown> = {};
                if (routeParentGateway) {
                    spec.parentRefs = [{ name: routeParentGateway }];
                }
                if (routeHostnames.trim() && kind !== 'TCPRoute' && kind !== 'UDPRoute') {
                    spec.hostnames = routeHostnames
                        .split(/[\s,]+/)
                        .map((h) => h.trim())
                        .filter(Boolean);
                }
                if (routeBackendService) {
                    spec.backendRefs = [{ name: routeBackendService }];
                }
                return {
                    apiVersion: 'gateway.networking.k8s.io/v1',
                    kind,
                    metadata: { name: meta.name, namespace: meta.namespace },
                    spec,
                };
            }
        }
    }

    function handleCreate() {
        if (nameError) return;
        if (stsClaimNameError) return;
        if (cmTarget && cmMechanism === 'envKey' && !cmKey) return;
        if (secretTarget && secretMechanism === 'envKey' && !secretKey) return;
        if (pvcMountTarget && (!pvcVolumeName.trim() || !!pvcMountReplicasError)) return;
        let link: ConfigMapLinkPayload | PvcLinkPayload | SecretLinkPayload | IngressTlsPayload | undefined;
        if (cmTarget) {
            const [targetKind, targetName] = cmTarget.split('|');
            link = {
                targetKind: targetKind as 'Pod' | 'Deployment' | 'DaemonSet' | 'StatefulSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                targetName,
                mechanism: cmMechanism,
                ...(cmMechanism === 'envKey' && cmKey ? { key: cmKey } : {}),
            };
        }
        if (kind === 'Secret' && secretTarget) {
            const [targetKind, targetName] = secretTarget.split('|');
            link = {
                targetKind: targetKind as 'Pod' | 'Deployment' | 'DaemonSet' | 'StatefulSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                targetName,
                mechanism: secretMechanism,
                ...(secretMechanism === 'envKey' && secretKey ? { key: secretKey } : {}),
                ...(secretMechanism === 'volumes' && secretVolumeName.trim()
                    ? { volumeName: secretVolumeName.trim() }
                    : {}),
            };
        }
        if (kind === 'Ingress' && ingressTlsSecret) {
            link = {
                secretName: ingressTlsSecret,
                hosts: ingressTlsHosts
                    .split(/[\s,]+/)
                    .map((h) => h.trim())
                    .filter(Boolean),
            };
        }
        if (kind === 'PersistentVolumeClaim') {
            let mountTarget: PvcLinkPayload['mountTarget'];
            if (pvcMountTarget) {
                const [targetKind, targetName] = pvcMountTarget.split('|');
                mountTarget = {
                    kind: targetKind as 'Pod' | 'Deployment' | 'DaemonSet' | 'StatefulSet' | 'ReplicaSet' | 'Job' | 'CronJob',
                    name: targetName,
                    volumeName: pvcVolumeName.trim(),
                };
            }
            let bindTarget: PvcLinkPayload['bindTarget'];
            if (pvcBindTarget) {
                const [bindKind, bindName] = pvcBindTarget.split('|');
                bindTarget = {
                    kind: bindKind as 'PersistentVolume' | 'StorageClass',
                    name: bindName,
                };
            }
            if (mountTarget || bindTarget) {
                link = { ...(mountTarget ? { mountTarget } : {}), ...(bindTarget ? { bindTarget } : {}) };
            }
        }
        const resource = buildResource();
        if (kind === 'DaemonSet') {
            addConfiguredNode(kind, resource, undefined, {
                desiredNodes: parseInt(desiredNodes, 10) || 1,
            });
        } else if (kind === 'StatefulSet' && stsVolumeClaims) {
            // The volume claim template materializes as a REAL PVC resource in
            // the same commit — the "claims" edge draws from the name match.
            const pvc: K8sResource = {
                apiVersion: 'v1',
                kind: 'PersistentVolumeClaim',
                metadata: {
                    name: stsClaimName.trim(),
                    namespace: namespace || 'default',
                    labels: { app: appLabel.trim() || name.trim() || suggestedName },
                },
                spec: {
                    accessModes: [stsClaimAccessMode],
                    resources: { requests: { storage: stsClaimSize.trim() || '1Gi' } },
                },
            };
            addConfiguredNodes([resource, pvc], {
                kind: 'StatefulSet',
                name: resource.metadata.name,
            });
        } else if (link) {
            addConfiguredNode(kind, resource, link);
        } else {
            addConfiguredNode(kind, resource);
        }
        onClose();
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header">
                    <div
                        className="modal-header__icon"
                        style={{
                            backgroundColor: hexToRgba(color, 0.13),
                            border: `1px solid ${hexToRgba(color, 0.28)}`,
                            color,
                        }}
                    >
                        {icon}
                    </div>
                    <span className="modal-header__title">Create {kind}</span>
                    <button type="button" className="modal-header__close" onClick={onClose} title="Close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* Base fields */}
                    <div className="modal-row">
                        <div className="modal-field">
                            <label className="modal-field__label">Name</label>
                            <input
                                ref={firstInputRef}
                                className={`modal-field__input ${nameError ? 'modal-field__input--invalid' : ''}`}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={suggestedName}
                            />
                            {nameError && <span className="modal-field__error">{nameError}</span>}
                        </div>
                        {!isClusterScoped(kind) && (
                            <div className="modal-field">
                                <label className="modal-field__label">Namespace</label>
                                <NamespaceField
                                    value={namespace}
                                    onChange={setNamespace}
                                    options={namespaceOptions}
                                />
                            </div>
                        )}
                    </div>

                    {/* App Label — auto-generated for workloads/Pods, target picker for Services */}
                    {(isWorkload || kind === 'Pod' || kind === 'Job' || kind === 'CronJob' || kind === 'DaemonSet') && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                App Label
                                <span className="modal-field__hint">
                                    {isWorkload || kind === 'Job' || kind === 'CronJob' || kind === 'DaemonSet'
                                        ? 'Auto-generated from the name. Sets metadata.labels.app and spec.selector.matchLabels.app.'
                                        : 'Auto-generated from the name. Sets metadata.labels.app — enables containment inside matching ReplicaSets.'}
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={appLabel}
                                onChange={(e) => {
                                    setAppLabelTouched(true);
                                    setAppLabelDraft(e.target.value);
                                }}
                                placeholder="my-app"
                            />
                        </div>
                    )}
                    {kind === 'Service' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Route to workload
                                <span className="modal-field__hint">
                                    Sets spec.selector.app — pick an existing workload or Pod to send traffic to.
                                </span>
                            </label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={appLabel}
                                onChange={(e) => {
                                    setAppLabelTouched(true);
                                    setAppLabelDraft(e.target.value);
                                }}
                            >
                                <option value="">(no selector yet)</option>
                                {workloadTargets.map((t) => (
                                    <option key={t.value} value={t.value}>
                                        {t.value} — {t.owners}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Workload: replicas */}
                    {isWorkload && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Replicas
                                <span className="modal-field__hint">
                                    {kind === 'Deployment'
                                        ? 'Its ReplicaSet and this many Pods are created automatically, like a real cluster.'
                                        : 'This many Pods are created automatically.'}
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                type="number"
                                min={0}
                                value={replicas}
                                onChange={(e) => setReplicas(e.target.value)}
                                placeholder="3"
                            />
                        </div>
                    )}

                    {/* DaemonSet: container + cluster node count (one Pod per node) */}
                    {kind === 'DaemonSet' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Container Name</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerName}
                                        onChange={(e) => setContainerName(e.target.value)}
                                        placeholder="app"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Image</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerImage}
                                        onChange={(e) => setContainerImage(e.target.value)}
                                        placeholder="nginx:latest"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Nodes
                                    <span className="modal-field__hint">
                                        Desired total nodes covering this
                                        namespace — existing nodes already over
                                        it count toward the total; missing ones
                                        are tiled over the namespace as
                                        canvas-only node rects. One DaemonSet
                                        box with one Pod runs on each.
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    type="number"
                                    min={1}
                                    value={desiredNodes}
                                    onChange={(e) => setDesiredNodes(e.target.value)}
                                    placeholder="3"
                                />
                                {daemonSetNodesError && (
                                    <span className="modal-field__error">{daemonSetNodesError}</span>
                                )}
                            </div>
                        </>
                    )}

                    {/* StatefulSet: container + optional volume claim template */}
                    {kind === 'StatefulSet' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Container Name</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerName}
                                        onChange={(e) => setContainerName(e.target.value)}
                                        placeholder="app"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Image</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerImage}
                                        onChange={(e) => setContainerImage(e.target.value)}
                                        placeholder="nginx:latest"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    <span className="modal-field__checkrow">
                                        <input
                                            type="checkbox"
                                            className="modal-field__checkbox"
                                            checked={stsVolumeClaims}
                                            onChange={(e) => setStsVolumeClaims(e.target.checked)}
                                        />
                                        <span className="modal-field__checkrow-text">
                                            Add a volume claim template (optional)
                                        </span>
                                    </span>
                                    <span className="modal-field__hint">
                                        Writes spec.volumeClaimTemplates — a PersistentVolumeClaim
                                        named after the template is created and linked to this
                                        StatefulSet (&quot;claims&quot; edge). In a real cluster
                                        each Pod gets its own claim.
                                    </span>
                                </label>
                            </div>
                            {stsVolumeClaims && (
                                <div className="modal-subsection modal-subsection--claim">
                                    <div className="modal-subsection__header">
                                        <svg
                                            className="modal-subsection__icon"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <ellipse cx="12" cy="5" rx="8" ry="3" />
                                            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
                                            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
                                        </svg>
                                        <span className="modal-subsection__title">
                                            Volume claim template
                                        </span>
                                        <span className="modal-subsection__badge">
                                            1 PVC per Pod
                                        </span>
                                    </div>
                                    <div className="modal-row">
                                        <div className="modal-field">
                                            <label className="modal-field__label">Claim name</label>
                                            <input
                                                className={`modal-field__input ${stsClaimNameError ? 'modal-field__input--invalid' : ''}`}
                                                value={stsClaimName}
                                                onChange={(e) => setStsClaimName(e.target.value)}
                                                placeholder="data"
                                            />
                                            {stsClaimNameError && (
                                                <span className="modal-field__error">{stsClaimNameError}</span>
                                            )}
                                        </div>
                                        <div className="modal-field">
                                            <label className="modal-field__label">Size Request</label>
                                            <input
                                                className="modal-field__input"
                                                value={stsClaimSize}
                                                onChange={(e) => setStsClaimSize(e.target.value)}
                                                placeholder="1Gi"
                                            />
                                        </div>
                                    </div>
                                    <div className="modal-field">
                                        <label className="modal-field__label">Access Mode</label>
                                        <select
                                            className="modal-field__input modal-field__input--select"
                                            value={stsClaimAccessMode}
                                            onChange={(e) => setStsClaimAccessMode(e.target.value)}
                                        >
                                            <option>ReadWriteOnce</option>
                                            <option>ReadOnlyMany</option>
                                            <option>ReadWriteMany</option>
                                            <option>ReadWriteOncePod</option>
                                        </select>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Pod: container */}
                    {kind === 'Pod' && (
                        <div className="modal-row">
                            <div className="modal-field">
                                <label className="modal-field__label">Container Name</label>
                                <input
                                    className="modal-field__input"
                                    value={containerName}
                                    onChange={(e) => setContainerName(e.target.value)}
                                    placeholder="app"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">Image</label>
                                <input
                                    className="modal-field__input"
                                    value={containerImage}
                                    onChange={(e) => setContainerImage(e.target.value)}
                                    placeholder="nginx:latest"
                                />
                            </div>
                        </div>
                    )}

                    {/* Job: restart policy + parallelism + completions */}
                    {kind === 'Job' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Restart Policy
                                    <span className="modal-field__hint">
                                        OnFailure restarts the failed container in the same Pod; Never lets the Pod fail so a new one is created.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={restartPolicy}
                                    onChange={(e) => setRestartPolicy(e.target.value)}
                                >
                                    <option>OnFailure</option>
                                    <option>Never</option>
                                </select>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Parallelism
                                        <span className="modal-field__hint">
                                            How many Pods run at the same time.
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={parallelism}
                                        onChange={(e) => setParallelism(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Completions
                                        <span className="modal-field__hint">
                                            Total Pods to run to completion.
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={completions}
                                        onChange={(e) => setCompletions(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Container Name</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerName}
                                        onChange={(e) => setContainerName(e.target.value)}
                                        placeholder="app"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Image</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerImage}
                                        onChange={(e) => setContainerImage(e.target.value)}
                                        placeholder="nginx:latest"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* CronJob: schedule + job template (restart/parallelism/completions) + pod (container/shell) */}
                    {kind === 'CronJob' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Schedule
                                    <span className="modal-field__hint">
                                        Standard 5-field cron (minute hour day month weekday),
                                        e.g. &quot;0 9 * * 1&quot; for every Monday 09:00, or an
                                        @-descriptor like @hourly. Runs every minute by default.
                                    </span>
                                </label>
                                <input
                                    className={`modal-field__input ${scheduleError ? 'modal-field__input--invalid' : ''}`}
                                    value={schedule}
                                    onChange={(e) => setSchedule(e.target.value)}
                                    placeholder="* * * * *"
                                />
                                {scheduleError && (
                                    <span className="modal-field__error">{scheduleError}</span>
                                )}
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Restart Policy
                                    <span className="modal-field__hint">
                                        OnFailure restarts the failed container in the same Pod;
                                        Never lets the Pod fail so a new one is created.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={restartPolicy}
                                    onChange={(e) => setRestartPolicy(e.target.value)}
                                >
                                    <option>OnFailure</option>
                                    <option>Never</option>
                                </select>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Parallelism
                                        <span className="modal-field__hint">
                                            How many Pods the created Job runs at the same time.
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={parallelism}
                                        onChange={(e) => setParallelism(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Completions
                                        <span className="modal-field__hint">
                                            Total Pods the created Job runs to completion.
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={completions}
                                        onChange={(e) => setCompletions(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Container Name</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerName}
                                        onChange={(e) => setContainerName(e.target.value)}
                                        placeholder="app"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Image</label>
                                    <input
                                        className="modal-field__input"
                                        value={containerImage}
                                        onChange={(e) => setContainerImage(e.target.value)}
                                        placeholder="nginx:latest"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    <span className="modal-field__checkrow">
                                        <input
                                            type="checkbox"
                                            className="modal-field__checkbox"
                                            checked={shellCommandEnabled}
                                            onChange={(e) => setShellCommandEnabled(e.target.checked)}
                                        />
                                        <span className="modal-field__checkrow-text">
                                            Run a shell command (optional)
                                        </span>
                                    </span>
                                    <span className="modal-field__hint">
                                        Runs /bin/sh -c &quot;&lt;command&gt;&quot; in the
                                        container instead of the image&apos;s default command.
                                    </span>
                                </label>
                            </div>
                            {shellCommandEnabled && (
                                <div className="modal-field">
                                    <label className="modal-field__label">Shell command</label>
                                    <textarea
                                        className="modal-field__input modal-field__input--textarea"
                                        value={shellCommand}
                                        onChange={(e) => setShellCommand(e.target.value)}
                                        placeholder="echo hello && date"
                                        rows={2}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {/* Service: type + ports */}
                    {kind === 'Service' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Service Type</label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={serviceType}
                                        onChange={(e) => setServiceType(e.target.value)}
                                    >
                                        <option>ClusterIP</option>
                                        <option>NodePort</option>
                                        <option>LoadBalancer</option>
                                        <option>ExternalName</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Port</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        value={port}
                                        onChange={(e) => setPort(e.target.value)}
                                        placeholder="80"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Target Port</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        value={targetPort}
                                        onChange={(e) => setTargetPort(e.target.value)}
                                        placeholder="8080"
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {/* Ingress: host + path + backend */}
                    {kind === 'Ingress' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Host</label>
                                    <input
                                        className="modal-field__input"
                                        value={host}
                                        onChange={(e) => setHost(e.target.value)}
                                        placeholder="my-app.example.com"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Path</label>
                                    <input
                                        className="modal-field__input"
                                        value={path}
                                        onChange={(e) => setPath(e.target.value)}
                                        placeholder="/"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Backend Service
                                    <span className="modal-field__hint">
                                        Lists the Services that currently exist on the canvas.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={backendService}
                                    onChange={(e) => setBackendService(e.target.value)}
                                >
                                    <option value="">(no backend yet)</option>
                                    {serviceOptions.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    TLS Secret (optional)
                                    <span className="modal-field__hint">
                                        Writes spec.tls[].secretName — terminate HTTPS with
                                        this Secret. Lists the Secrets that currently exist
                                        on the canvas.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={ingressTlsSecret}
                                    onChange={(e) => setIngressTlsSecret(e.target.value)}
                                >
                                    <option value="">(no TLS)</option>
                                    {ingressTlsSecretOptions.map((s) => (
                                        <option key={s} value={s}>{s}</option>
                                    ))}
                                </select>
                            </div>
                            {ingressTlsSecret && (
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        TLS hosts
                                        <span className="modal-field__hint">
                                            One per line or comma-separated. Leave empty to
                                            terminate TLS for all hosts.
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        value={ingressTlsHosts}
                                        onChange={(e) => setIngressTlsHosts(e.target.value)}
                                        placeholder="app.example.com"
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {/* HorizontalPodAutoscaler: scale target + replica bounds */}
                    {kind === 'HorizontalPodAutoscaler' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Scale target
                                    <span className="modal-field__hint">
                                        Sets spec.scaleTargetRef — the Deployment, ReplicaSet or StatefulSet this HorizontalPodAutoscaler scales.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={targetWorkload}
                                    onChange={(e) => setTargetWorkload(e.target.value)}
                                >
                                    <option value="">(select a workload)</option>
                                    {workloadOptions.map((w) => (
                                        <option key={`${w.kind}|${w.name}`} value={`${w.kind}|${w.name}`}>
                                            {w.kind} {w.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Min Replicas</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={minReplicas}
                                        onChange={(e) => setMinReplicas(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Max Replicas</label>
                                    <input
                                        className="modal-field__input"
                                        type="number"
                                        min={1}
                                        value={maxReplicas}
                                        onChange={(e) => setMaxReplicas(e.target.value)}
                                        placeholder="10"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    CPU Target %
                                    <span className="modal-field__hint">
                                        Sets metrics[0].resource.target.averageUtilization.
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={cpuTarget}
                                    onChange={(e) => setCpuTarget(e.target.value)}
                                    placeholder="70"
                                />
                            </div>
                        </>
                    )}

                    {/* VPA: targetRef + update mode + resource bounds */}
                    {kind === 'VerticalPodAutoscaler' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Target (targetRef)
                                    <span className="modal-field__hint">
                                        Sets spec.targetRef — the Deployment, ReplicaSet, DaemonSet, StatefulSet, Pod, Job or CronJob whose Pod container requests this VPA adjusts.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={vpaTarget}
                                    onChange={(e) => setVpaTarget(e.target.value)}
                                >
                                    <option value="">(select a target)</option>
                                    {vpaTargetOptions.map((w) => (
                                        <option key={`${w.kind}|${w.name}`} value={`${w.kind}|${w.name}`}>
                                            {w.kind} {w.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Update Mode
                                    <span className="modal-field__hint">
                                        Auto applies recommended requests to new Pods; Initial only to the first; Recreate evicts running Pods; Off never applies.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={vpaUpdateMode}
                                    onChange={(e) => setVpaUpdateMode(e.target.value)}
                                >
                                    <option>Auto</option>
                                    <option>Initial</option>
                                    <option>Recreate</option>
                                    <option>Off</option>
                                </select>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Min CPU</label>
                                    <input
                                        className="modal-field__input"
                                        value={vpaMinCpu}
                                        onChange={(e) => setVpaMinCpu(e.target.value)}
                                        placeholder="100m"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Max CPU</label>
                                    <input
                                        className="modal-field__input"
                                        value={vpaMaxCpu}
                                        onChange={(e) => setVpaMaxCpu(e.target.value)}
                                        placeholder="1"
                                    />
                                </div>
                            </div>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Min Memory</label>
                                    <input
                                        className="modal-field__input"
                                        value={vpaMinMemory}
                                        onChange={(e) => setVpaMinMemory(e.target.value)}
                                        placeholder="256Mi"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Max Memory</label>
                                    <input
                                        className="modal-field__input"
                                        value={vpaMaxMemory}
                                        onChange={(e) => setVpaMaxMemory(e.target.value)}
                                        placeholder="2Gi"
                                    />
                                </div>
                            </div>
                            <span className="modal-field__hint">
                                Bounds write spec.resourcePolicy.containerPolicies[0] (containerName &quot;*&quot;). Leave empty for unbounded.
                            </span>
                        </>
                    )}

                    {/* ConfigMap: labels + annotations + data */}
                    {kind === 'ConfigMap' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Labels
                                    <span className="modal-field__hint">
                                        Comma-separated key=value pairs (optional). These can be
                                        matched by workloads and selectors elsewhere in the cluster.
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    value={cmLabels}
                                    onChange={(e) => setCmLabels(e.target.value)}
                                    placeholder="app=my-app,tier=config"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Annotations
                                    <span className="modal-field__hint">
                                        Comma-separated key=value pairs (optional).
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    value={cmAnnotations}
                                    onChange={(e) => setCmAnnotations(e.target.value)}
                                    placeholder="owner=team-a"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Data
                                    <span className="modal-field__hint">
                                        Optional key/value entries — injected into Pods via
                                        envFrom, env.valueFrom or volumes.
                                    </span>
                                </label>
                                <ConfigMapDataEditor
                                    resource={{
                                        apiVersion: 'v1',
                                        kind: 'ConfigMap',
                                        metadata: { name: name.trim() || suggestedName },
                                        data: cmData,
                                    }}
                                    resetToken="create-configmap"
                                    onCommit={setCmData}
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Link to a resource (optional)
                                    <span className="modal-field__hint">
                                        Picks a Pod, ReplicaSet or Deployment that will consume
                                        this ConfigMap. Selecting a controller-created Pod writes
                                        the reference to its owner&apos;s Pod template.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={cmTarget}
                                    onChange={(e) => {
                                        setCmTarget(e.target.value);
                                        setCmKey('');
                                    }}
                                >
                                    <option value="">(no target — just create the ConfigMap)</option>
                                    {cmTargetOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {cmTarget && (
                                <>
                                    <div className="modal-field">
                                        <label className="modal-field__label">
                                            Reference mechanism
                                            <span className="modal-field__hint">
                                                How the target consumes the ConfigMap.
                                            </span>
                                        </label>
                                        <select
                                            className="modal-field__input modal-field__input--select"
                                            value={cmMechanism}
                                            onChange={(e) => {
                                                setCmMechanism(e.target.value as ConfigMapMechanism);
                                                setCmKey('');
                                            }}
                                        >
                                            <option value="envFrom">envFrom — inject all keys as env vars</option>
                                            <option value="volumes">volumes — mount as files</option>
                                            <option value="envKey">env — inject a single key</option>
                                        </select>
                                    </div>
                                    {cmMechanism === 'envKey' && (
                                        <div className="modal-field">
                                            <label className="modal-field__label">
                                                Data key
                                                <span className="modal-field__hint">
                                                    The ConfigMap key injected as an env var.
                                                </span>
                                            </label>
                                            <select
                                                className="modal-field__input modal-field__input--select"
                                                value={cmKey}
                                                onChange={(e) => setCmKey(e.target.value)}
                                            >
                                                <option value="">(select a key)</option>
                                                {cmDataKeys.map((k) => (
                                                    <option key={k} value={k}>
                                                        {k}
                                                    </option>
                                                ))}
                                            </select>
                                            {cmDataKeys.length === 0 && (
                                                <span className="modal-field__error">
                                                    This ConfigMap has no data keys — add some above or
                                                    pick envFrom / volumes.
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {/* Secret: labels + annotations + data + optional link */}
                    {kind === 'Secret' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Labels
                                    <span className="modal-field__hint">
                                        Comma-separated key=value pairs (optional).
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    value={secretLabels}
                                    onChange={(e) => setSecretLabels(e.target.value)}
                                    placeholder="app=my-app"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Annotations
                                    <span className="modal-field__hint">
                                        Comma-separated key=value pairs (optional).
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    value={secretAnnotations}
                                    onChange={(e) => setSecretAnnotations(e.target.value)}
                                    placeholder="owner=team-a"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Data
                                    <span className="modal-field__hint">
                                        Optional key/value entries — injected into Pods via
                                        envFrom, env.valueFrom or volumes. Values are stored
                                        as-is (Kubernetes expects base64 in spec.data).
                                    </span>
                                </label>
                                <ConfigMapDataEditor
                                    resource={{
                                        apiVersion: 'v1',
                                        kind: 'Secret',
                                        metadata: { name: name.trim() || suggestedName },
                                        data: secretData,
                                    }}
                                    resetToken="create-secret"
                                    onCommit={setSecretData}
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Link to a resource (optional)
                                    <span className="modal-field__hint">
                                        Picks a Pod, ReplicaSet or Deployment that will consume
                                        this Secret. Selecting a controller-created Pod writes
                                        the reference to its owner&apos;s Pod template.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={secretTarget}
                                    onChange={(e) => {
                                        setSecretTarget(e.target.value);
                                        setSecretKey('');
                                    }}
                                >
                                    <option value="">(no target — just create the Secret)</option>
                                    {secretTargetOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {secretTarget && (
                                <>
                                    <div className="modal-field">
                                        <label className="modal-field__label">
                                            Reference mechanism
                                            <span className="modal-field__hint">
                                                How the target consumes the Secret.
                                            </span>
                                        </label>
                                        <select
                                            className="modal-field__input modal-field__input--select"
                                            value={secretMechanism}
                                            onChange={(e) => {
                                                setSecretMechanism(e.target.value as SecretMechanism);
                                                setSecretKey('');
                                            }}
                                        >
                                            <option value="envFrom">envFrom — inject all keys as env vars</option>
                                            <option value="volumes">volumes — mount as files</option>
                                            <option value="envKey">env — inject a single key</option>
                                        </select>
                                    </div>
                                    {secretMechanism === 'envKey' && (
                                        <div className="modal-field">
                                            <label className="modal-field__label">
                                                Data key
                                                <span className="modal-field__hint">
                                                    The Secret key injected as an env var.
                                                </span>
                                            </label>
                                            <select
                                                className="modal-field__input modal-field__input--select"
                                                value={secretKey}
                                                onChange={(e) => setSecretKey(e.target.value)}
                                            >
                                                <option value="">(select a key)</option>
                                                {secretDataKeys.map((k) => (
                                                    <option key={k} value={k}>
                                                        {k}
                                                    </option>
                                                ))}
                                            </select>
                                            {secretDataKeys.length === 0 && (
                                                <span className="modal-field__error">
                                                    This Secret has no data keys — add some above or
                                                    pick envFrom / volumes.
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {secretMechanism === 'volumes' && (
                                        <div className="modal-field">
                                            <label className="modal-field__label">
                                                Volume name
                                                <span className="modal-field__hint">
                                                    The volume name inside the Pod (defaults to the
                                                    Secret name).
                                                </span>
                                            </label>
                                            <input
                                                className="modal-field__input"
                                                value={secretVolumeName}
                                                onChange={(e) => setSecretVolumeName(e.target.value)}
                                                placeholder={name.trim() || suggestedName}
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {/* PVC: access modes + size + optional mount/bind links */}
                    {kind === 'PersistentVolumeClaim' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Access Mode</label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={pvcAccessModes}
                                        onChange={(e) => setPvcAccessModes(e.target.value)}
                                    >
                                        <option>ReadWriteOnce</option>
                                        <option>ReadOnlyMany</option>
                                        <option>ReadWriteMany</option>
                                        <option>ReadWriteOncePod</option>
                                    </select>
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Size Request</label>
                                    <input
                                        className="modal-field__input"
                                        value={pvcSize}
                                        onChange={(e) => setPvcSize(e.target.value)}
                                        placeholder="1Gi"
                                    />
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Mount into (optional)
                                    <span className="modal-field__hint">
                                        Writes spec.volumes[].persistentVolumeClaim into a Pod
                                        or a workload&apos;s Pod template (Deployment/ReplicaSet).
                                        Requires a volume name.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={pvcMountTarget}
                                    onChange={(e) => {
                                        setPvcMountTarget(e.target.value);
                                        if (e.target.value && !pvcVolumeName) {
                                            setPvcVolumeName(name.trim() || suggestedName);
                                        }
                                    }}
                                >
                                    <option value="">(no mount — just create the claim)</option>
                                    {pvcMountOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                                {pvcMountReplicasError && (
                                    <span className="modal-field__error">{pvcMountReplicasError}</span>
                                )}
                            </div>
                            {pvcMountTarget && (
                                <div className="modal-field">
                                    <label className="modal-field__label">Volume name</label>
                                    <input
                                        className="modal-field__input"
                                        value={pvcVolumeName}
                                        onChange={(e) => setPvcVolumeName(e.target.value)}
                                        placeholder={name.trim() || suggestedName}
                                    />
                                </div>
                            )}
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Bind to (optional)
                                    <span className="modal-field__hint">
                                        A PVC binds to exactly one target — a PV sets
                                        spec.volumeName, a StorageClass sets
                                        spec.storageClassName.
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={pvcBindTarget}
                                    onChange={(e) => setPvcBindTarget(e.target.value)}
                                >
                                    <option value="">(unbound — no storageClassName, no volumeName)</option>
                                    {pvOptions.map((pv) => (
                                        <option
                                            key={`PersistentVolume|${pv.name}`}
                                            value={`PersistentVolume|${pv.name}`}
                                        >
                                            PV {pv.name}
                                            {pv.bound ? ` (claimed by ${pv.bound})` : ''}
                                        </option>
                                    ))}
                                    {storageClassOptions.map((sc) => (
                                        <option key={`StorageClass|${sc}`} value={`StorageClass|${sc}`}>
                                            StorageClass {sc}
                                        </option>
                                    ))}
                                </select>
                                {pvcBindTarget && (
                                    <span className="modal-field__hint">
                                        {pvcBindTarget.startsWith('PersistentVolume')
                                            ? 'Writes spec.volumeName — the claim binds to that PV directly.'
                                            : 'Writes spec.storageClassName — the claim provisions storage through that class.'}
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {/* PV: capacity + access modes + reclaim policy */}
                    {kind === 'PersistentVolume' && (
                        <>
                            <div className="modal-row">
                                <div className="modal-field">
                                    <label className="modal-field__label">Capacity</label>
                                    <input
                                        className="modal-field__input"
                                        value={pvCapacity}
                                        onChange={(e) => setPvCapacity(e.target.value)}
                                        placeholder="10Gi"
                                    />
                                </div>
                                <div className="modal-field">
                                    <label className="modal-field__label">Access Mode</label>
                                    <select
                                        className="modal-field__input modal-field__input--select"
                                        value={pvAccessModes}
                                        onChange={(e) => setPvAccessModes(e.target.value)}
                                    >
                                        <option>ReadWriteOnce</option>
                                        <option>ReadOnlyMany</option>
                                        <option>ReadWriteMany</option>
                                        <option>ReadWriteOncePod</option>
                                    </select>
                                </div>
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">Reclaim Policy</label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={pvReclaimPolicy}
                                    onChange={(e) => setPvReclaimPolicy(e.target.value)}
                                >
                                    <option>Retain</option>
                                    <option>Recycle</option>
                                    <option>Delete</option>
                                </select>
                            </div>
                        </>
                    )}

                    {/* StorageClass: provisioner + reclaim policy */}
                    {kind === 'StorageClass' && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Provisioner
                                    <span className="modal-field__hint">
                                        The storage provisioner that creates volumes for
                                        claims using this class.
                                    </span>
                                </label>
                                <input
                                    className="modal-field__input"
                                    value={scProvisioner}
                                    onChange={(e) => setScProvisioner(e.target.value)}
                                    placeholder="kubernetes.io/no-provisioner"
                                />
                            </div>
                            <div className="modal-field">
                                <label className="modal-field__label">Reclaim Policy</label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={scReclaimPolicy}
                                    onChange={(e) => setScReclaimPolicy(e.target.value)}
                                >
                                    <option>Delete</option>
                                    <option>Retain</option>
                                    <option>Recycle</option>
                                </select>
                            </div>
                        </>
                    )}

                    {/* GatewayClass: controller name (cluster-scoped) */}
                    {kind === 'GatewayClass' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Controller Name
                                <span className="modal-field__hint">
                                    spec.controllerName — the controller that reconciles
                                    Gateways of this class.
                                </span>
                            </label>
                            <input
                                className="modal-field__input"
                                value={gcControllerName}
                                onChange={(e) => setGcControllerName(e.target.value)}
                                placeholder="acme.io/gateway-controller"
                            />
                        </div>
                    )}

                    {/* Gateway: pick its GatewayClass (spec.gatewayClassName) */}
                    {kind === 'Gateway' && (
                        <div className="modal-field">
                            <label className="modal-field__label">
                                Gateway Class
                                <span className="modal-field__hint">
                                    A Gateway is created from exactly one GatewayClass.
                                </span>
                            </label>
                            <select
                                className="modal-field__input modal-field__input--select"
                                value={gwClassName}
                                onChange={(e) => setGwClassName(e.target.value)}
                            >
                                <option value="">(no class yet)</option>
                                {gatewayClassOptions.map((gc) => (
                                    <option key={gc} value={gc}>{gc}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Routes (HTTPRoute/GRPCRoute/TCPRoute/TLSRoute/UDPRoute): parent Gateway + backends */}
                    {(kind === 'HTTPRoute' || kind === 'GRPCRoute' || kind === 'TCPRoute' || kind === 'TLSRoute' || kind === 'UDPRoute') && (
                        <>
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Parent Gateway
                                    <span className="modal-field__hint">
                                        The Gateway this route attaches to (spec.parentRefs).
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={routeParentGateway}
                                    onChange={(e) => setRouteParentGateway(e.target.value)}
                                >
                                    <option value="">(no parent yet)</option>
                                    {gatewayOptions.map((gw) => (
                                        <option key={gw} value={gw}>{gw}</option>
                                    ))}
                                </select>
                            </div>
                            {kind !== 'TCPRoute' && kind !== 'UDPRoute' && (
                                <div className="modal-field">
                                    <label className="modal-field__label">
                                        Hostnames
                                        <span className="modal-field__hint">
                                            Comma-separated spec.hostnames (SNI matching for TLSRoute).
                                        </span>
                                    </label>
                                    <input
                                        className="modal-field__input"
                                        value={routeHostnames}
                                        onChange={(e) => setRouteHostnames(e.target.value)}
                                        placeholder="api.example.com"
                                    />
                                </div>
                            )}
                            <div className="modal-field">
                                <label className="modal-field__label">
                                    Backend Service
                                    <span className="modal-field__hint">
                                        A Route only routes to Services (spec.backendRefs).
                                    </span>
                                </label>
                                <select
                                    className="modal-field__input modal-field__input--select"
                                    value={routeBackendService}
                                    onChange={(e) => setRouteBackendService(e.target.value)}
                                >
                                    <option value="">(no backend yet)</option>
                                    {serviceOptions.map((svc) => (
                                        <option key={svc} value={svc}>{svc}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button type="button" className="modal-btn modal-btn--secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="modal-btn modal-btn--primary"
                        style={{ '--btn-color': color } as React.CSSProperties}
                        onClick={handleCreate}
                        disabled={
                            !!nameError ||
                            !!stsClaimNameError ||
                            !!scheduleError ||
                            !!daemonSetNodesError ||
                            (kind === 'ConfigMap' && !!cmTarget && cmMechanism === 'envKey' && !cmKey) ||
                            (kind === 'Secret' && !!secretTarget && secretMechanism === 'envKey' && !secretKey) ||
                            (kind === 'PersistentVolumeClaim' && !!pvcMountTarget && (!pvcVolumeName.trim() || !!pvcMountReplicasError))
                        }
                        title={
                            nameError ||
                            stsClaimNameError ||
                            scheduleError ||
                            daemonSetNodesError ||
                            (kind === 'ConfigMap' && cmTarget && cmMechanism === 'envKey' && !cmKey
                                ? 'Select a data key first'
                                : kind === 'Secret' && secretTarget && secretMechanism === 'envKey' && !secretKey
                                ? 'Select a data key first'
                                : kind === 'PersistentVolumeClaim' && pvcMountTarget && !pvcVolumeName.trim()
                                ? 'Volume name is required to mount the claim'
                                : kind === 'PersistentVolumeClaim' && pvcMountReplicasError
                                ? pvcMountReplicasError
                                : `Create ${kind}`)
                        }
                    >
                        Create {kind}
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Parse "k=v,k2=v2" into a map (empty input → undefined). */
function parseKeyValueString(value: string): Record<string, string> | undefined {
    if (!value.trim()) return undefined;
    const obj: Record<string, string> = {};
    value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((pair) => {
            const [k, ...rest] = pair.split('=');
            if (!k || rest.length === 0) return;
            obj[k.trim()] = rest.join('=').trim();
        });
    return Object.keys(obj).length ? obj : undefined;
}
