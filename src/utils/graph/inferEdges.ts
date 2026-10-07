import { type Edge, type Node, MarkerType } from '@xyflow/react';
import type { K8sResource } from '../../types/types';
import type { K8sNodeData } from './graphTypes';
import { edgeColorForPair, type BuildGraphContext } from './graphContext';
import { getSelector, getTargetLabels, getWorkloadPodLabels, matchesSelector } from './selectors';
import { getHpaTarget, getVpaTarget } from './autoscaling';
import { getConfigMapRefs, getPvcRefs, getPvForPvc, getStorageClassForPvc, getSecretRefs } from './podSpecRefs';
import {
    getGatewayClassName,
    getIngressServiceNames,
    getIngressTlsSecretNames,
    getRouteBackendRefNames,
    getRouteParentRefNames,
} from './networkRefs';

/** 12. GENERATE EDGES (Traffic Flow). Returns the inferred edges for the built graph. */
export function inferEdges(ctx: BuildGraphContext): Edge[] {
    const edges: Edge[] = [];
    const byId = new Map<string, Node<K8sNodeData>>();
    ctx.nodes.forEach((n) => byId.set(n.id, n));

    const edgeSet = new Set<string>();

    const addEdge = (sourceId: string, targetId: string, label: string) => {
        const source = byId.get(sourceId);
        const target = byId.get(targetId);
        if (!source || !target) return;

        const id = `${sourceId}->${targetId}:${label}`;
        if (edgeSet.has(id)) return;
        edgeSet.add(id);

        edges.push({
            id,
            source: sourceId,
            target: targetId,
            label,
            animated: true,
            // Inferred from YAML, pure visualization. Not deletable/selectable (edit the
            // relationship via inspector/YAML), no fat hit-area, and tagged with
            // `edge--inferred` so CSS can make the visible stroke fully click-
            // transparent: React Flow z-elevates edges whose endpoints are nested
            // nodes above top-level node cards, and a clickable stroke would
            // swallow clicks on any node it crosses (see reactflow-overrides.css).
            deletable: false,
            selectable: false,
            className: 'edge--inferred',
            interactionWidth: 0,
            style: {
                stroke: edgeColorForPair(source.data.kind, target.data.kind),
                strokeWidth: 2.2,
                filter: 'drop-shadow(0 0 4px rgba(96, 165, 250, 0.4))'
            },
            markerEnd: {
                type: MarkerType.ArrowClosed,
                width: 14,
                height: 14,
                color: edgeColorForPair(source.data.kind, target.data.kind),
            }
        });
    };

    // Ingress → Service
    ctx.ingresses.forEach((ing) => {
        const ingId = ctx.idByResource.get(ing);
        if (!ingId) return;
        getIngressServiceNames(ing).forEach((svcName) => {
            const svcId = ctx.serviceIdByName.get(svcName);
            if (svcId) addEdge(ingId, svcId, 'routes to');
        });
    });

    // CronJob → Job "triggers": every CronJob draws an edge to the Job it would
    // create for its next scheduled run (always the CronJob's own synthetic Job,
    // it never claims an existing one).
    ctx.cronJobs.forEach((cron) => {
        const cronId = ctx.idByResource.get(cron);
        if (!cronId) return;
        const job = ctx.cronToJob.get(cron);
        if (!job) return;
        const jobId = ctx.idByResource.get(job);
        if (jobId) addEdge(cronId, jobId, 'triggers');
    });

    // Job → Pod: every Pod a Job runs (claimed or materialized, including the
    // Jobs a CronJob synthesizes) is linked to its Job by an inferred edge: the
    // Job is the only owner these Pods have.
    [...ctx.jobs, ...ctx.syntheticCronJobs].forEach((job) => {
        const jobId = ctx.idByResource.get(job);
        if (!jobId) return;
        const children = ctx.jobToPod.get(job) ?? [];
        children.forEach((pod) => {
            const podId = ctx.idByResource.get(pod);
            if (podId) addEdge(jobId, podId, 'owns');
        });
    });

    // Service → Pod (real Kubernetes networking: Services select Pods by labels,
    // including the controller-materialized ones). Falls back to a Service → workload
    // edge only when the workload matches but currently runs no pods (replicas: 0).
    ctx.services.forEach((svc) => {
        const svcId = ctx.idByResource.get(svc);
        const selector = getSelector(svc);
        if (!svcId || !selector) return;

        const svcSpec = svc.spec as { ports?: Array<{ port?: number }> } | undefined;
        const port = svcSpec?.ports?.[0]?.port;
        const edgeLabel = port ? `port: ${port}` : 'selects';

        const matchedPods = new Set<K8sResource>();
        ctx.allPods.forEach((pod) => {
            if (matchesSelector(selector, getTargetLabels(pod))) {
                matchedPods.add(pod);
                const podId = ctx.idByResource.get(pod);
                if (podId) addEdge(svcId, podId, edgeLabel);
            }
        });

        const workloadHasMatchedPod = (workload: K8sResource): boolean => {
            const contained =
                workload.kind === 'Deployment'
                    ? (ctx.depToRs.get(workload) ?? []).flatMap((rs) => ctx.rsToPod.get(rs) ?? [])
                    : (ctx.rsToPod.get(workload) ?? []);
            return contained.some((pod) => matchedPods.has(pod));
        };

        [...ctx.deployments, ...ctx.replicaSets].forEach((workload) => {
            if (!matchesSelector(selector, getWorkloadPodLabels(workload))) return;
            if (workloadHasMatchedPod(workload)) return; // already connected to its pods
            // Skip nested ReplicaSets, connect to their owning Deployment instead
            if (workload.kind === 'ReplicaSet' && ctx.claimedRs.has(workload)) return;
            const wId = ctx.idByResource.get(workload);
            if (wId) addEdge(svcId, wId, edgeLabel);
        });
    });

    // HorizontalPodAutoscaler → scale target (Deployment/ReplicaSet)
    const workloadIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'Deployment' || n.data.kind === 'ReplicaSet') {
            const key = `${n.data.kind}:${n.data.name}`;
            if (!workloadIdByName.has(key)) workloadIdByName.set(key, n.id);
        }
    });

    ctx.hpas.forEach((hpa) => {
        const hpaId = ctx.idByResource.get(hpa);
        if (!hpaId) return;
        const target = getHpaTarget(hpa);
        if (!target) return;
        const targetId = workloadIdByName.get(`${target.kind}:${target.name}`);
        if (targetId) addEdge(hpaId, targetId, 'scales');
    });

    // VerticalPodAutoscaler → targetRef (Deployment/ReplicaSet/Pod/Job/CronJob):
    // a VPA right-sizes the Pods of the resource it points at, so the edge goes
    // to the targetRef node itself, never to the Pods nested inside it.
    const vpaTargetIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (
            n.data.kind === 'Deployment' ||
            n.data.kind === 'ReplicaSet' ||
            n.data.kind === 'Pod' ||
            n.data.kind === 'Job' ||
            n.data.kind === 'CronJob'
        ) {
            const key = `${n.data.kind}:${n.data.name}`;
            if (!vpaTargetIdByName.has(key)) vpaTargetIdByName.set(key, n.id);
        }
    });

    ctx.vpas.forEach((vpa) => {
        const vpaId = ctx.idByResource.get(vpa);
        if (!vpaId) return;
        const target = getVpaTarget(vpa);
        if (!target) return;
        const targetId = vpaTargetIdByName.get(`${target.kind}:${target.name}`);
        if (targetId) addEdge(vpaId, targetId, 'right-sizes');
    });

    // ConfigMap → "uses": every workload (real Deployment/ReplicaSet/Pod) whose Pod
    // spec references a ConfigMap draws an edge to it. Synthetic RSs/Pods are not
    // part of `resources`, so no double edges for inherited refs.
    const configmapIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'ConfigMap' && !configmapIdByName.has(n.data.name)) {
            configmapIdByName.set(n.data.name, n.id);
        }
    });

    /** The node ID a workload's semantic edges originate from: the single node
     *  carrying the resource. */
    const workloadIdsOf = (workload: K8sResource): string[] => {
        const id = ctx.idByResource.get(workload);
        return id ? [id] : [];
    };

    ctx.resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const refs = getConfigMapRefs(workload);
        if (refs.length === 0) return;
        workloadIdsOf(workload).forEach((workloadId) => {
            refs.forEach((cmName) => {
                const cmId = configmapIdByName.get(cmName);
                if (cmId) addEdge(workloadId, cmId, 'uses');
            });
        });
    });

    // Secret → "uses": every workload (real Deployment/ReplicaSet/Pod) whose Pod
    // spec references a Secret (envFrom[].secretRef, env[].valueFrom.secretKeyRef
    // or volumes[].secret) draws an edge to it.
    const secretIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'Secret' && !secretIdByName.has(n.data.name)) {
            secretIdByName.set(n.data.name, n.id);
        }
    });

    ctx.resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const refs = getSecretRefs(workload);
        if (refs.length === 0) return;
        workloadIdsOf(workload).forEach((workloadId) => {
            refs.forEach((secretName) => {
                const secretId = secretIdByName.get(secretName);
                if (secretId) addEdge(workloadId, secretId, 'uses');
            });
        });
    });

    // Ingress → Secret "tls": every Ingress whose spec.tls[].secretName points at
    // a Secret on the canvas draws a TLS termination edge to it.
    ctx.ingresses.forEach((ing) => {
        const ingId = ctx.idByResource.get(ing);
        if (!ingId) return;
        getIngressTlsSecretNames(ing).forEach((secretName) => {
            const secretId = secretIdByName.get(secretName);
            if (secretId) addEdge(ingId, secretId, 'tls');
        });
    });

    // PersistentVolumeClaim → "mounts": every workload (real Deployment/ReplicaSet/Pod)
    // whose Pod spec declares spec.volumes[].persistentVolumeClaim draws an edge to the
    // claim. A PVC binds to exactly one target: a PV via spec.volumeName, or a
    // StorageClass via spec.storageClassName ("binds" edge). Missing targets draw
    // nothing (no controller simulation).
    const pvcIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'PersistentVolumeClaim' && !pvcIdByName.has(n.data.name)) {
            pvcIdByName.set(n.data.name, n.id);
        }
    });

    ctx.resources.forEach((workload) => {
        if (workload.kind !== 'Deployment' && workload.kind !== 'ReplicaSet' && workload.kind !== 'Pod' && workload.kind !== 'Job' && workload.kind !== 'CronJob') {
            return;
        }
        const refs = getPvcRefs(workload);
        if (refs.length === 0) return;
        workloadIdsOf(workload).forEach((workloadId) => {
            refs.forEach((claimName) => {
                const pvcId = pvcIdByName.get(claimName);
                if (pvcId) addEdge(workloadId, pvcId, 'mounts');
            });
        });
    });

    const pvIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'PersistentVolume' && !pvIdByName.has(n.data.name)) {
            pvIdByName.set(n.data.name, n.id);
        }
    });
    const storageClassIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'StorageClass' && !storageClassIdByName.has(n.data.name)) {
            storageClassIdByName.set(n.data.name, n.id);
        }
    });

    ctx.pvcs.forEach((pvc) => {
        const pvcId = ctx.idByResource.get(pvc);
        if (!pvcId) return;
        const pvName = getPvForPvc(pvc);
        if (pvName) {
            const pvId = pvIdByName.get(pvName);
            if (pvId) addEdge(pvcId, pvId, 'binds');
        }
        const scName = getStorageClassForPvc(pvc);
        if (scName && !pvName) {
            const scId = storageClassIdByName.get(scName);
            if (scId) addEdge(pvcId, scId, 'binds');
        }
    });

    // Gateway API: Gateway → GatewayClass "class" (spec.gatewayClassName, 1:1),
    // Route → Gateway "attaches" (spec.parentRefs[].name) and Route → Service
    // "routes to" (spec.backendRefs[].name). Explicit-only like storage/ConfigMap:
    // a missing target draws nothing.
    const gatewayClassIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'GatewayClass' && !gatewayClassIdByName.has(n.data.name)) {
            gatewayClassIdByName.set(n.data.name, n.id);
        }
    });
    const gatewayIdByName = new Map<string, string>();
    ctx.nodes.forEach((n) => {
        if (n.data.kind === 'Gateway' && !gatewayIdByName.has(n.data.name)) {
            gatewayIdByName.set(n.data.name, n.id);
        }
    });

    ctx.gateways.forEach((gw) => {
        const gwId = ctx.idByResource.get(gw);
        if (!gwId) return;
        const className = getGatewayClassName(gw);
        if (!className) return;
        const classId = gatewayClassIdByName.get(className);
        if (classId) addEdge(gwId, classId, 'class');
    });

    ctx.routes.forEach((route) => {
        const routeId = ctx.idByResource.get(route);
        if (!routeId) return;
        getRouteParentRefNames(route).forEach((parentName) => {
            const parentId = gatewayIdByName.get(parentName);
            if (parentId) addEdge(routeId, parentId, 'attaches');
        });
        getRouteBackendRefNames(route).forEach((svcName) => {
            const svcId = ctx.serviceIdByName.get(svcName);
            if (svcId) addEdge(routeId, svcId, 'routes to');
        });
    });

    return edges;
}
