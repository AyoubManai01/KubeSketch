import { create } from 'zustand';
import { computeInitialState } from './initialState';
import { createCanvasActions } from './actions/canvasActions';
import { createLinkActions } from './actions/linkActions';
import { createCreationActions } from './actions/creationActions';
import { createNsLayoutActions } from './actions/nsLayoutActions';
import { createFileActions } from './actions/fileActions';
import type { KubeSketchState } from './types';

/**
 * The KubeSketch store: the single source of truth for the app. YAML text, canvas
 * nodes/edges, the inspector and relationships are all projections of one
 * resource model (see ./types.ts for the state shape and ../utils/buildGraph
 * for the graph derivation; every structural mutation funnels through
 * commitResources in ./graphCommit.ts).
 *
 * The module path stays `../store/store`: components and tests import (and
 * vi.mock) it, so the re-exports below keep that surface stable.
 */
export const useKubeSketchStore = create<KubeSketchState>((set, get) => ({
    ...computeInitialState(),
    ...createCanvasActions(set, get),
    ...createLinkActions(set),
    ...createCreationActions(set),
    ...createNsLayoutActions(set, get),
    ...createFileActions(set),
}));

// Re-export the public store surface so existing `../store/store` importers
// (components, utils and the test mocks) keep working unchanged.
export { DEFAULT_YAML } from './constants';
export { apiVersionForKind } from './graphCommit';
export { readNsLayout } from './persistence';
export type {
    CanvasNotice,
    ConfigMapLinkPayload,
    IngressTlsPayload,
    PendingConfigMapLink,
    PendingIngressTlsLink,
    PendingPvcLink,
    PendingSecretLink,
    PvcLinkPayload,
    SecretLinkPayload,
    SelectedResource,
} from './types';
