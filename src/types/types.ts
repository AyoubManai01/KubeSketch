/**
 * Represents a parsed Kubernetes resource extracted from YAML.
 * Supports core workload/network/autoscaling resource kinds for architecture mapping.
 */
export interface K8sResource {
  apiVersion: string;
  kind:
    | 'Deployment'
    | 'DaemonSet'
    | 'StatefulSet'
    | 'Service'
    | 'Ingress'
    | 'Pod'
    | 'ReplicaSet'
    | 'HorizontalPodAutoscaler'
    | 'ConfigMap'
    | 'PersistentVolumeClaim'
    | 'PersistentVolume'
    | 'StorageClass'
    | 'Secret'
    | 'Job'
    | 'CronJob'
    | 'VerticalPodAutoscaler'
    | 'GatewayClass'
    | 'Gateway'
    | 'HTTPRoute'
    | 'GRPCRoute'
    | 'TCPRoute'
    | 'TLSRoute'
    | 'UDPRoute';
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  [key: string]: unknown; // allow extra fields without breaking typing
}

/** The set of Kubernetes resource kinds supported in the canvas */
export const SUPPORTED_KINDS = [
  'Deployment',
  'DaemonSet',
  'StatefulSet',
  'Service',
  'Ingress',
  'Pod',
  'ReplicaSet',
  'HorizontalPodAutoscaler',
  'ConfigMap',
  'PersistentVolumeClaim',
  'PersistentVolume',
  'StorageClass',
  'Secret',
  'Job',
  'CronJob',
  'VerticalPodAutoscaler',
  'GatewayClass',
  'Gateway',
  'HTTPRoute',
  'GRPCRoute',
  'TCPRoute',
  'TLSRoute',
  'UDPRoute',
] as const;
export type SupportedKind = (typeof SUPPORTED_KINDS)[number];
