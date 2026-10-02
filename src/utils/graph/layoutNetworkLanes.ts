import type { K8sResource } from '../../types/types';
import {
    HPA_HEIGHT,
    HPA_WIDTH,
    INGRESS_HEIGHT,
    SERVICE_HEIGHT,
    VPA_HEIGHT,
    VPA_WIDTH,
} from './graphTypes';
import { getSavedPosition, resolveCollisions, type BuildGraphContext } from './graphContext';
import { getSelector, getTargetLabels, matchesSelector } from './selectors';
import { getHpaTarget, getVpaTarget } from './autoscaling';
import { getIngressServiceNames } from './networkRefs';

/** 2. LAY OUT SERVICES (auto-aligned above the Pods they select, Y = 175). */
export function layoutServices(ctx: BuildGraphContext): void {
    const serviceLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let serviceXCursor = 50;

    ctx.services.forEach((svc) => {
        const svcId = ctx.allocateId(svc);
        const key = `Service:${svc.metadata.name}`;
        const savedPos = getSavedPosition('Service', svc.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Find selected Pods to center the Service above them
            const selector = getSelector(svc);
            const matchingIds: string[] = [];

            if (selector) {
                ctx.allPods.forEach((pod) => {
                    if (matchesSelector(selector, getTargetLabels(pod))) {
                        const id = ctx.idByResource.get(pod);
                        if (id) matchingIds.push(id);
                    }
                });
            }

            if (matchingIds.length > 0) {
                const sumX = matchingIds.reduce((acc, pId) => acc + (ctx.absCoords.get(pId)?.x || 0), 0);
                preferredX = sumX / matchingIds.length;
            } else {
                preferredX = serviceXCursor;
                serviceXCursor += 200;
            }
        }

        serviceLayoutInfo.push({
            id: svcId,
            x: preferredX,
            width: 170,
            node: svc,
        });
    });

    // Resolve Service overlaps (only for non-user-dragged nodes)
    const draggedServiceIds = new Set(
        serviceLayoutInfo
            .filter(({ node }) => ctx.prevCoords.has(`Service:${node.metadata.name}`) || getSavedPosition('Service', node.metadata.name))
            .map(({ id }) => id)
    );

    resolveCollisions(serviceLayoutInfo, draggedServiceIds, 24);

    serviceLayoutInfo.forEach((sInfo) => {
        const key = `Service:${sInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('Service', sInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 175;

        const pos = { x: sInfo.x, y: yCoord };
        ctx.absCoords.set(sInfo.id, pos);

        ctx.nodes.push({
            id: sInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: 170, height: SERVICE_HEIGHT },
            data: {
                kind: 'Service',
                name: sInfo.node.metadata.name,
                namespace: sInfo.node.metadata.namespace,
                resource: sInfo.node,
            },
            draggable: true,
        });
    });

    // Name → node ID lookup for services (first occurrence wins for duplicates)
    ctx.services.forEach((svc) => {
        const id = ctx.idByResource.get(svc);
        if (id && !ctx.serviceIdByName.has(svc.metadata.name)) {
            ctx.serviceIdByName.set(svc.metadata.name, id);
        }
    });
}

/** 3. LAY OUT INGRESSES (auto-aligned above the Services they target, Y = 25). */
export function layoutIngresses(ctx: BuildGraphContext): void {
    const ingressLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let ingressXCursor = 50;

    ctx.ingresses.forEach((ing) => {
        const ingId = ctx.allocateId(ing);
        const key = `Ingress:${ing.metadata.name}`;
        const savedPos = getSavedPosition('Ingress', ing.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Find targeted services
            const targetIds = getIngressServiceNames(ing)
                .map((name) => ctx.serviceIdByName.get(name))
                .filter((id): id is string => !!id && ctx.absCoords.has(id));

            if (targetIds.length > 0) {
                const sumX = targetIds.reduce((acc, tId) => acc + (ctx.absCoords.get(tId)?.x || 0), 0);
                preferredX = sumX / targetIds.length;
            } else {
                preferredX = ingressXCursor;
                ingressXCursor += 210;
            }
        }

        ingressLayoutInfo.push({
            id: ingId,
            x: preferredX,
            width: 180,
            node: ing,
        });
    });

    const draggedIngressIds = new Set(
        ingressLayoutInfo
            .filter(({ node }) => ctx.prevCoords.has(`Ingress:${node.metadata.name}`) || getSavedPosition('Ingress', node.metadata.name))
            .map(({ id }) => id)
    );

    resolveCollisions(ingressLayoutInfo, draggedIngressIds, 24);

    ingressLayoutInfo.forEach((iInfo) => {
        const key = `Ingress:${iInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('Ingress', iInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 25;

        const pos = { x: iInfo.x, y: yCoord };
        ctx.absCoords.set(iInfo.id, pos);

        ctx.nodes.push({
            id: iInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: 180, height: INGRESS_HEIGHT },
            data: {
                kind: 'Ingress',
                name: iInfo.node.metadata.name,
                namespace: iInfo.node.metadata.namespace,
                resource: iInfo.node,
            },
            draggable: true,
        });
    });
}

/**
 * 4. LAY OUT AUTOSCALERS (HorizontalPodAutoscalers + VPAs): shared lane at Y = 520, resolved
 *    in ONE collision pass so the two kinds never overlap in X.
 */
export function layoutAutoscalers(ctx: BuildGraphContext): void {
    const hpaLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let hpaXCursor = 50;

    ctx.hpas.forEach((hpa) => {
        const hpaId = ctx.allocateId(hpa);
        const key = `HorizontalPodAutoscaler:${hpa.metadata.name}`;
        const savedPos = getSavedPosition('HorizontalPodAutoscaler', hpa.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Center above the workload it scales when possible
            const target = getHpaTarget(hpa);
            const targetId = target
                ? ctx.nodes.find((n) => n.data.kind === target.kind && n.data.name === target.name)?.id
                : undefined;
            if (targetId && ctx.absCoords.has(targetId)) {
                preferredX = ctx.absCoords.get(targetId)!.x;
            } else {
                preferredX = hpaXCursor;
                hpaXCursor += 200;
            }
        }

        hpaLayoutInfo.push({
            id: hpaId,
            x: preferredX,
            width: HPA_WIDTH,
            node: hpa,
        });
    });

    const vpaLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let vpaXCursor = 50;

    ctx.vpas.forEach((vpa) => {
        const vpaId = ctx.allocateId(vpa);
        const key = `VerticalPodAutoscaler:${vpa.metadata.name}`;
        const savedPos = getSavedPosition('VerticalPodAutoscaler', vpa.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            // Center above the workload/Pod it right-sizes when possible
            const target = getVpaTarget(vpa);
            const targetId = target
                ? ctx.nodes.find((n) => n.data.kind === target.kind && n.data.name === target.name)?.id
                : undefined;
            if (targetId && ctx.absCoords.has(targetId)) {
                preferredX = ctx.absCoords.get(targetId)!.x;
            } else {
                preferredX = vpaXCursor;
                vpaXCursor += 210;
            }
        }

        vpaLayoutInfo.push({
            id: vpaId,
            x: preferredX,
            width: VPA_WIDTH,
            node: vpa,
        });
    });

    const autoscalerLayoutInfo = [...hpaLayoutInfo, ...vpaLayoutInfo];
    const draggedAutoscalerIds = new Set(
        autoscalerLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`${node.kind}:${node.metadata.name}`) ||
                    getSavedPosition(node.kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(autoscalerLayoutInfo, draggedAutoscalerIds, 24);

    autoscalerLayoutInfo.forEach((aInfo) => {
        const key = `${aInfo.node.kind}:${aInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition(aInfo.node.kind, aInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 520;

        const pos = { x: aInfo.x, y: yCoord };
        ctx.absCoords.set(aInfo.id, pos);

        ctx.nodes.push({
            id: aInfo.id,
            type: 'k8sNode',
            position: pos,
            style: {
                width: aInfo.node.kind === 'HorizontalPodAutoscaler' ? HPA_WIDTH : VPA_WIDTH,
                height: aInfo.node.kind === 'HorizontalPodAutoscaler' ? HPA_HEIGHT : VPA_HEIGHT,
            },
            data: {
                kind: aInfo.node.kind,
                name: aInfo.node.metadata.name,
                namespace: aInfo.node.metadata.namespace,
                resource: aInfo.node,
            },
            draggable: true,
        });
    });
}
