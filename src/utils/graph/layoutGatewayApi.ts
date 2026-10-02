import type { K8sResource, SupportedKind } from '../../types/types';
import {
    GATEWAYCLASS_HEIGHT,
    GATEWAYCLASS_WIDTH,
    GATEWAY_HEIGHT,
    GATEWAY_WIDTH,
    ROUTE_HEIGHT,
    ROUTE_WIDTH,
} from './graphTypes';
import { getSavedPosition, resolveCollisions, type BuildGraphContext } from './graphContext';

/**
 * 10. LAY OUT GATEWAY API: GatewayClass (cluster-scoped, outside any namespace
 *     box) and Gateway (namespaced) share the gateway lane (Y = 1480) with a
 *     single combined collision pass so the two kinds never overlap.
 * 11. LAY OUT ROUTES: every Gateway API route kind (HTTPRoute/GRPCRoute/TCPRoute/
 *     TLSRoute) shares the route lane (Y = 1640) with a single combined collision
 *     pass so the four kinds never overlap.
 */
export function layoutGatewayApi(ctx: BuildGraphContext): void {
    const gatewayLaneInfo: Array<{
        id: string;
        x: number;
        width: number;
        kind: 'GatewayClass' | 'Gateway';
        node: K8sResource;
    }> = [];
    let gatewayClassXCursor = 50;
    let gatewayXCursor = 50;

    ctx.gatewayClasses.forEach((gc) => {
        const gcId = ctx.allocateId(gc);
        const prevPos = ctx.prevCoords.get(`GatewayClass:${gc.metadata.name}`);
        const savedPos = getSavedPosition('GatewayClass', gc.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = gatewayClassXCursor;
            gatewayClassXCursor += GATEWAYCLASS_WIDTH + 24;
        }
        gatewayLaneInfo.push({
            id: gcId,
            x: preferredX,
            width: GATEWAYCLASS_WIDTH,
            kind: 'GatewayClass',
            node: gc,
        });
    });

    ctx.gateways.forEach((gw) => {
        const gwId = ctx.allocateId(gw);
        const prevPos = ctx.prevCoords.get(`Gateway:${gw.metadata.name}`);
        const savedPos = getSavedPosition('Gateway', gw.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = gatewayXCursor;
            gatewayXCursor += GATEWAY_WIDTH + 24;
        }
        gatewayLaneInfo.push({
            id: gwId,
            x: preferredX,
            width: GATEWAY_WIDTH,
            kind: 'Gateway',
            node: gw,
        });
    });

    const draggedGatewayLaneIds = new Set(
        gatewayLaneInfo
            .filter(
                ({ kind, node }) =>
                    ctx.prevCoords.has(`${kind}:${node.metadata.name}`) ||
                    getSavedPosition(kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(gatewayLaneInfo, draggedGatewayLaneIds, 24);

    gatewayLaneInfo.forEach((info) => {
        const prevPos = ctx.prevCoords.get(`${info.kind}:${info.node.metadata.name}`);
        const savedPos = getSavedPosition(info.kind, info.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1480;
        const width = info.kind === 'GatewayClass' ? GATEWAYCLASS_WIDTH : GATEWAY_WIDTH;
        const height = info.kind === 'GatewayClass' ? GATEWAYCLASS_HEIGHT : GATEWAY_HEIGHT;
        const pos = { x: info.x, y: yCoord };
        ctx.absCoords.set(info.id, pos);

        ctx.nodes.push({
            id: info.id,
            type: 'k8sNode',
            position: pos,
            style: { width, height },
            data: {
                kind: info.kind,
                name: info.node.metadata.name,
                namespace: info.node.metadata.namespace,
                resource: info.node,
            },
            draggable: true,
        });
    });

    const routeLaneInfo: Array<{ id: string; x: number; width: number; kind: SupportedKind; node: K8sResource }> = [];
    let routeXCursor = 50;

    ctx.routes.forEach((route) => {
        const routeId = ctx.allocateId(route);
        const prevPos = ctx.prevCoords.get(`${route.kind}:${route.metadata.name}`);
        const savedPos = getSavedPosition(route.kind, route.metadata.name);
        let preferredX = prevPos?.x ?? savedPos?.x;
        if (preferredX === undefined) {
            preferredX = routeXCursor;
            routeXCursor += ROUTE_WIDTH + 24;
        }
        routeLaneInfo.push({
            id: routeId,
            x: preferredX,
            width: ROUTE_WIDTH,
            kind: route.kind,
            node: route,
        });
    });

    const draggedRouteLaneIds = new Set(
        routeLaneInfo
            .filter(
                ({ kind, node }) =>
                    ctx.prevCoords.has(`${kind}:${node.metadata.name}`) ||
                    getSavedPosition(kind, node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(routeLaneInfo, draggedRouteLaneIds, 24);

    routeLaneInfo.forEach((info) => {
        const prevPos = ctx.prevCoords.get(`${info.kind}:${info.node.metadata.name}`);
        const savedPos = getSavedPosition(info.kind, info.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1640;
        const pos = { x: info.x, y: yCoord };
        ctx.absCoords.set(info.id, pos);

        ctx.nodes.push({
            id: info.id,
            type: 'k8sNode',
            position: pos,
            style: { width: ROUTE_WIDTH, height: ROUTE_HEIGHT },
            data: {
                kind: info.kind,
                name: info.node.metadata.name,
                namespace: info.node.metadata.namespace,
                resource: info.node,
            },
            draggable: true,
        });
    });
}
