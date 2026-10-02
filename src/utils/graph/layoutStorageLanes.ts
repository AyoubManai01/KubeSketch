import type { K8sResource } from '../../types/types';
import {
    CONFIGMAP_HEIGHT,
    CONFIGMAP_WIDTH,
    PVC_HEIGHT,
    PVC_WIDTH,
    PV_HEIGHT,
    PV_WIDTH,
    SECRET_HEIGHT,
    SECRET_WIDTH,
    STORAGECLASS_HEIGHT,
    STORAGECLASS_WIDTH,
} from './graphTypes';
import { getSavedPosition, resolveCollisions, type BuildGraphContext } from './graphContext';

/** 5. LAY OUT CONFIGMAPS (lane below HorizontalPodAutoscalers, Y = 680). */
export function layoutConfigMaps(ctx: BuildGraphContext): void {
    const configmapLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let configmapXCursor = 50;

    ctx.configmaps.forEach((cm) => {
        const cmId = ctx.allocateId(cm);
        const key = `ConfigMap:${cm.metadata.name}`;
        const savedPos = getSavedPosition('ConfigMap', cm.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = configmapXCursor;
            configmapXCursor += 210;
        }

        configmapLayoutInfo.push({
            id: cmId,
            x: preferredX,
            width: CONFIGMAP_WIDTH,
            node: cm,
        });
    });

    const draggedConfigmapIds = new Set(
        configmapLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`ConfigMap:${node.metadata.name}`) ||
                    getSavedPosition('ConfigMap', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(configmapLayoutInfo, draggedConfigmapIds, 24);

    configmapLayoutInfo.forEach((cmInfo) => {
        const key = `ConfigMap:${cmInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('ConfigMap', cmInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 680;

        const pos = { x: cmInfo.x, y: yCoord };
        ctx.absCoords.set(cmInfo.id, pos);

        ctx.nodes.push({
            id: cmInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: CONFIGMAP_WIDTH, height: CONFIGMAP_HEIGHT },
            data: {
                kind: 'ConfigMap',
                name: cmInfo.node.metadata.name,
                namespace: cmInfo.node.metadata.namespace,
                resource: cmInfo.node,
            },
            draggable: true,
        });
    });
}

/**
 * 6. LAY OUT PVCs (PersistentVolumeClaims): claim lane below ConfigMaps.
 *    PVCs are claimed by Pods (spec.volumes[].persistentVolumeClaim) and bind
 *    to exactly one PV (spec.volumeName) or StorageClass (spec.storageClassName).
 */
export function layoutPvcs(ctx: BuildGraphContext): void {
    const pvcLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let pvcXCursor = 50;

    ctx.pvcs.forEach((pvc) => {
        const pvcId = ctx.allocateId(pvc);
        const key = `PersistentVolumeClaim:${pvc.metadata.name}`;
        const savedPos = getSavedPosition('PersistentVolumeClaim', pvc.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = pvcXCursor;
            pvcXCursor += 205;
        }

        pvcLayoutInfo.push({
            id: pvcId,
            x: preferredX,
            width: PVC_WIDTH,
            node: pvc,
        });
    });

    const draggedPvcIds = new Set(
        pvcLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`PersistentVolumeClaim:${node.metadata.name}`) ||
                    getSavedPosition('PersistentVolumeClaim', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(pvcLayoutInfo, draggedPvcIds, 24);

    pvcLayoutInfo.forEach((pvcInfo) => {
        const key = `PersistentVolumeClaim:${pvcInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('PersistentVolumeClaim', pvcInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 840;

        const pos = { x: pvcInfo.x, y: yCoord };
        ctx.absCoords.set(pvcInfo.id, pos);

        ctx.nodes.push({
            id: pvcInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: PVC_WIDTH, height: PVC_HEIGHT },
            data: {
                kind: 'PersistentVolumeClaim',
                name: pvcInfo.node.metadata.name,
                namespace: pvcInfo.node.metadata.namespace,
                resource: pvcInfo.node,
            },
            draggable: true,
        });
    });
}

/** 7. LAY OUT PVs (PersistentVolumes): bind lane below PVCs. */
export function layoutPvs(ctx: BuildGraphContext): void {
    const pvLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let pvXCursor = 50;

    ctx.pvs.forEach((pv) => {
        const pvId = ctx.allocateId(pv);
        const key = `PersistentVolume:${pv.metadata.name}`;
        const savedPos = getSavedPosition('PersistentVolume', pv.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = pvXCursor;
            pvXCursor += 205;
        }

        pvLayoutInfo.push({
            id: pvId,
            x: preferredX,
            width: PV_WIDTH,
            node: pv,
        });
    });

    const draggedPvIds = new Set(
        pvLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`PersistentVolume:${node.metadata.name}`) ||
                    getSavedPosition('PersistentVolume', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(pvLayoutInfo, draggedPvIds, 24);

    pvLayoutInfo.forEach((pvInfo) => {
        const key = `PersistentVolume:${pvInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('PersistentVolume', pvInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1000;

        const pos = { x: pvInfo.x, y: yCoord };
        ctx.absCoords.set(pvInfo.id, pos);

        ctx.nodes.push({
            id: pvInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: PV_WIDTH, height: PV_HEIGHT },
            data: {
                kind: 'PersistentVolume',
                name: pvInfo.node.metadata.name,
                namespace: pvInfo.node.metadata.namespace,
                resource: pvInfo.node,
            },
            draggable: true,
        });
    });
}

/** 8. LAY OUT STORAGECLASSES: provisioning lane below PVs. */
export function layoutStorageClasses(ctx: BuildGraphContext): void {
    const storageClassLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let storageClassXCursor = 50;

    ctx.storageClasses.forEach((sc) => {
        const scId = ctx.allocateId(sc);
        const key = `StorageClass:${sc.metadata.name}`;
        const savedPos = getSavedPosition('StorageClass', sc.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = storageClassXCursor;
            storageClassXCursor += 215;
        }

        storageClassLayoutInfo.push({
            id: scId,
            x: preferredX,
            width: STORAGECLASS_WIDTH,
            node: sc,
        });
    });

    const draggedStorageClassIds = new Set(
        storageClassLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`StorageClass:${node.metadata.name}`) ||
                    getSavedPosition('StorageClass', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(storageClassLayoutInfo, draggedStorageClassIds, 24);

    storageClassLayoutInfo.forEach((scInfo) => {
        const key = `StorageClass:${scInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('StorageClass', scInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1160;

        const pos = { x: scInfo.x, y: yCoord };
        ctx.absCoords.set(scInfo.id, pos);

        ctx.nodes.push({
            id: scInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: STORAGECLASS_WIDTH, height: STORAGECLASS_HEIGHT },
            data: {
                kind: 'StorageClass',
                name: scInfo.node.metadata.name,
                namespace: scInfo.node.metadata.namespace,
                resource: scInfo.node,
            },
            draggable: true,
        });
    });
}

/** 9. LAY OUT SECRETS: secret lane below StorageClasses. */
export function layoutSecrets(ctx: BuildGraphContext): void {
    const secretLayoutInfo: Array<{ id: string; x: number; width: number; node: K8sResource }> = [];
    let secretXCursor = 50;

    ctx.secrets.forEach((secret) => {
        const secretId = ctx.allocateId(secret);
        const key = `Secret:${secret.metadata.name}`;
        const savedPos = getSavedPosition('Secret', secret.metadata.name);
        const prevPos = ctx.prevCoords.get(key);

        let preferredX = 0;
        if (prevPos) {
            preferredX = prevPos.x;
        } else if (savedPos) {
            preferredX = savedPos.x;
        } else {
            preferredX = secretXCursor;
            secretXCursor += 210;
        }

        secretLayoutInfo.push({
            id: secretId,
            x: preferredX,
            width: SECRET_WIDTH,
            node: secret,
        });
    });

    const draggedSecretIds = new Set(
        secretLayoutInfo
            .filter(
                ({ node }) =>
                    ctx.prevCoords.has(`Secret:${node.metadata.name}`) ||
                    getSavedPosition('Secret', node.metadata.name)
            )
            .map(({ id }) => id)
    );

    resolveCollisions(secretLayoutInfo, draggedSecretIds, 24);

    secretLayoutInfo.forEach((secretInfo) => {
        const key = `Secret:${secretInfo.node.metadata.name}`;
        const prevPos = ctx.prevCoords.get(key);
        const savedPos = getSavedPosition('Secret', secretInfo.node.metadata.name);
        const yCoord = prevPos?.y ?? savedPos?.y ?? 1320;

        const pos = { x: secretInfo.x, y: yCoord };
        ctx.absCoords.set(secretInfo.id, pos);

        ctx.nodes.push({
            id: secretInfo.id,
            type: 'k8sNode',
            position: pos,
            style: { width: SECRET_WIDTH, height: SECRET_HEIGHT },
            data: {
                kind: 'Secret',
                name: secretInfo.node.metadata.name,
                namespace: secretInfo.node.metadata.namespace,
                resource: secretInfo.node,
            },
            draggable: true,
        });
    });
}
