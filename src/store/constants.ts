/** localStorage keys persisting the app state between sessions. */
export const YAML_KEY = 'veltra_yaml';
export const USER_EDGES_KEY = 'veltra_user_edges';
export const POSITIONS_KEY = 'veltra_node_positions';
export const NS_LAYOUT_KEY = 'veltra_ns_layout';
export const FILE_EXPLORER_KEY = 'veltra_file_explorer';
export const ACTIVE_FILE_KEY = 'veltra_active_file';

/** Default YAML shown when the app first loads */
export const DEFAULT_YAML = `# Paste your Kubernetes YAML here (multi-document with ---)
# Recognized resources: Deployment, Service, Ingress, ReplicaSet, Pod, HorizontalPodAutoscaler,
# ConfigMap, PersistentVolumeClaim, PersistentVolume, StorageClass, Secret, Job,
# CronJob, VerticalPodAutoscaler, GatewayClass, Gateway, HTTPRoute, GRPCRoute,
# TCPRoute, TLSRoute, UDPRoute
#
# Like a real cluster, Veltra materializes a Deployment's ReplicaSet and
# Pods on the canvas automatically, you only declare the Deployment.
# A CronJob's Job (and its Pods) are materialized the same way.

apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  labels:
    app: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: app
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: my-app-svc
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-app-ingress
spec:
  rules:
    - host: my-app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-app-svc
                port:
                  number: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: my-app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: my-app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`;
