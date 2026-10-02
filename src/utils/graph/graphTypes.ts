import type { K8sResource, SupportedKind } from '../../types/types';

/** Data payload we attach to each React Flow node */
export interface K8sNodeData {
    kind: SupportedKind;
    name: string;
    namespace?: string;
    resource: K8sResource;
    /** True for controller-managed resources Veltra materializes (like a real cluster
     *  creating a Deployment's ReplicaSet and Pods). Never serialized back to YAML. */
    synthetic?: boolean;
    /** For synthetic resources: the nearest REAL resource that controls them. */
    managedBy?: { kind: SupportedKind; name: string };
    [key: string]: unknown;
}

// Dimensions configuration
export const POD_WIDTH = 150;
export const POD_HEIGHT = 110; // fits header + namespace/container/image rows without overflowing the parent
export const SERVICE_HEIGHT = 104;
export const INGRESS_HEIGHT = 104;
export const HPA_WIDTH = 175;
export const HPA_HEIGHT = 104; // fits header + target/min/max rows without overflowing
export const VPA_WIDTH = 185;
export const VPA_HEIGHT = 104; // fits header + target/updateMode rows without overflowing
export const CONFIGMAP_WIDTH = 180;
export const CONFIGMAP_HEIGHT = 104; // fits header + data rows without overflowing the leaf box
export const PVC_WIDTH = 175;
export const PVC_HEIGHT = 124; // fits header + accessModes/storage/binding rows without overflowing the leaf box
export const PV_WIDTH = 175;
export const PV_HEIGHT = 124;
export const STORAGECLASS_WIDTH = 185;
export const STORAGECLASS_HEIGHT = 124;
export const SECRET_WIDTH = 180;
export const SECRET_HEIGHT = 104; // fits header + data rows without overflowing the leaf box
export const JOB_WIDTH = 180;
export const JOB_HEIGHT = 124; // fits header + restart/parallelism/completions rows without overflowing the leaf box
export const CRONJOB_WIDTH = 185;
export const CRONJOB_HEIGHT = 150; // fits header + schedule/parallelism/completions/container/image rows without overflowing the leaf box
export const RS_HEADER_HEIGHT = 45;
export const DEP_HEADER_HEIGHT = 45;

export const RS_PADDING = { top: 10, left: 16, right: 16, bottom: 16 };
export const DEP_PADDING = { top: 15, left: 20, right: 20, bottom: 20 };

export const POD_GAP = 12;
export const RS_GAP = 20;
export const WORKLOAD_GAP = 48;

export const GATEWAYCLASS_WIDTH = 185;
export const GATEWAYCLASS_HEIGHT = 124; // fits header + controllerName rows without overflowing the leaf box
export const GATEWAY_WIDTH = 185;
export const GATEWAY_HEIGHT = 124; // fits header + class/listener rows without overflowing the leaf box
export const ROUTE_WIDTH = 180;
export const ROUTE_HEIGHT = 124; // fits header + parent/backend/host rows without overflowing the leaf box

/** Upper bound on materialized Pods per ReplicaSet, keeps huge replica counts renderable.
 *  The replica badge on the workload always shows the true desired count. */
export const MAX_SYNTHETIC_PODS = 15;

/**
 * Access modes that bind a claim to a single node (ReadWriteOnce / ReadWriteOncePod).
 * Such a PVC cannot be mounted by every Pod of a multi-replica workload: identical
 * Pods of a Deployment/ReplicaSet all claim the same volume, and only one node may
 * attach it. ReadOnlyMany / ReadWriteMany are node-shareable and always allowed.
 */
export const SINGLE_NODE_ACCESS_MODES = new Set(['ReadWriteOnce', 'ReadWriteOncePod']);
