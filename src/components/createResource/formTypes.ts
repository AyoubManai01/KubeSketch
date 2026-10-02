import type { ReactNode } from 'react';
import type { ConfigMapMechanism, SecretMechanism } from '../../utils/linkResources';

/** Every raw input field of the create-resource form (all backing useState hooks). */
export interface CreateFormState {
    name: string;
    namespace: string;
    nsCreateOpen: boolean;
    appLabelDraft: string;
    appLabelTouched: boolean;
    replicas: string;
    containerName: string;
    containerImage: string;
    serviceType: string;
    port: string;
    targetPort: string;
    host: string;
    path: string;
    backendService: string;
    targetWorkload: string;
    minReplicas: string;
    maxReplicas: string;
    cpuTarget: string;
    vpaTarget: string;
    vpaUpdateMode: string;
    vpaMinCpu: string;
    vpaMaxCpu: string;
    vpaMinMemory: string;
    vpaMaxMemory: string;
    cmLabels: string;
    cmAnnotations: string;
    cmData?: Record<string, string>;
    cmTarget: string;
    cmMechanism: ConfigMapMechanism;
    cmKey: string;
    secretLabels: string;
    secretAnnotations: string;
    secretData?: Record<string, string>;
    secretTarget: string;
    secretMechanism: SecretMechanism;
    secretKey: string;
    secretVolumeName: string;
    ingressTlsSecret: string;
    ingressTlsHosts: string;
    pvcAccessModes: string;
    pvcSize: string;
    pvcMountTarget: string;
    pvcVolumeName: string;
    pvcBindTarget: string;
    pvCapacity: string;
    pvAccessModes: string;
    pvReclaimPolicy: string;
    scProvisioner: string;
    scReclaimPolicy: string;
    restartPolicy: string;
    parallelism: string;
    completions: string;
    schedule: string;
    shellCommandEnabled: boolean;
    shellCommand: string;
    gcControllerName: string;
    gwClassName: string;
    routeParentGateway: string;
    routeBackendService: string;
    routeHostnames: string;
}

/** One setter per raw field, named `set<Field>` (maps 1:1 to the useState setters). */
export type CreateFormSetters = {
    [K in keyof CreateFormState as `set${Capitalize<K>}`]-?: (value: CreateFormState[K]) => void;
};

/** Derived values computed from the raw fields + the live canvas (memos). */
export interface CreateFormDerived {
    suggestedName: string;
    nameError: string;
    namespaceError: string;
    scheduleError: string;
    appLabel: string;
    color: string;
    icon: ReactNode;
    isWorkload: boolean;
    serviceOptions: string[];
    gatewayClassOptions: string[];
    gatewayOptions: string[];
    workloadOptions: Array<{ kind: string; name: string }>;
    vpaTargetOptions: Array<{ kind: string; name: string }>;
    workloadTargets: Array<{ value: string; owners: string }>;
    namespaceOptions: string[];
    cmTargetOptions: Array<{ label: string; value: string }>;
    cmDataKeys: string[];
    secretTargetOptions: Array<{ label: string; value: string }>;
    secretDataKeys: string[];
    ingressTlsSecretOptions: string[];
    pvcMountOptions: Array<{ label: string; value: string }>;
    pvcMountReplicasError: string | null;
    pvOptions: Array<{ name: string; bound?: string }>;
    storageClassOptions: string[];
}

/** Everything the form sections need: raw state, setters and derived values. */
export interface CreateFormBundle {
    state: CreateFormState;
    set: CreateFormSetters;
    derived: CreateFormDerived;
}