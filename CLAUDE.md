# CLAUDE.md

Veltra is a Kubernetes Visual IDE: a split-screen app with a Monaco YAML editor (left) and a React Flow resource canvas (right), kept in bidirectional sync. Supported resource kinds: Deployment, ReplicaSet, Pod, Service, Ingress, HPA (HorizontalPodAutoscaler).

The canvas simulates Kubernetes controllers: a Deployment with no matching ReplicaSet in the manifest gets a **synthetic** RS (named `<name>-<hash>`, deterministic), and every RS (real or synthetic) materializes Pods up to `spec.replicas` on top of any explicit Pods its selector claims. Synthetic nodes carry `data.synthetic: true` + `data.managedBy` (nearest real owner) and are display-only.

## Commands

```bash
npm run dev      # Vite dev server → http://localhost:5173/
npm run build    # tsc -b && vite build (typecheck + bundle)
npm run lint     # eslint
```

There is no test suite. Verify changes by driving the running app in a browser — see `.claude/skills/verify/SKILL.md` for the full recipe and its gotchas (localStorage reset, clipboard-paste into Monaco, handle-drag connections).

## Architecture

Single source of truth: the Zustand store ([src/store/store.ts](src/store/store.ts)). YAML text, canvas nodes/edges, the inspector, and relationships are all projections of one resource model.

Data flow:

```
YAML text ──parseYaml──▶ K8sResource[] ──buildGraph──▶ nodes + inferredEdges
     ▲                                                        │
     └──── resourcesToYaml ◀── toResources(nodes) ◀── canvas/inspector edits
```

- [src/utils/parseYaml.ts](src/utils/parseYaml.ts) — multi-doc YAML → filtered `K8sResource[]`.
- [src/utils/buildGraph.ts](src/utils/buildGraph.ts) — resources → React Flow nodes (nested containment: Pod ⊂ ReplicaSet ⊂ Deployment) + inferred edges (ingress backends, service selectors, HPA scaleTargetRefs), plus lane-based auto-layout and collision resolution.
- [src/utils/linkResources.ts](src/utils/linkResources.ts) — semantic meaning of manual canvas connections (writes selectors/labels/backends into the model).
- [src/utils/serializeYaml.ts](src/utils/serializeYaml.ts) — resources → YAML (`skipInvalid: true`).
- [src/components/Canvas.tsx](src/components/Canvas.tsx) — canvas + node inspector. [src/components/YamlEditor.tsx](src/components/YamlEditor.tsx) — Monaco + selected-resource highlight. [src/components/CreateResourceModal.tsx](src/components/CreateResourceModal.tsx) — resource creation with validation.

localStorage keys: `veltra_yaml`, `veltra_user_edges`, `veltra_node_positions`.

## Invariants — do not break these

They each encode a fixed bug; regressing one reintroduces it.

1. **Node IDs are `Kind-name`** (`nodeIdFor`). Renames change the ID, so any rename path must remap `userEdges`, migrate the stored position key, and update the selection. Selection is stored as `{kind, name}` (`selectedResource`) in the store — never hold a node ID in component state (that's what used to close the inspector mid-rename).
2. **All structural mutations funnel through `commitResources`** in the store (rebuild graph → merge edges → serialize YAML only when sync is on). Don't add parallel update paths.
3. **Dragging never touches YAML.** Positions aren't part of YAML; serializing on drag destroys user comments/formatting. Position/selection/dimension changes go through `setCanvasNodesPositionOnly` (a bare `set({nodes})`).
4. **Only user-dragged nodes get pinned** (`persistNodePositions(draggedIds)` on drag stop). Persisting auto-layout positions on commits permanently disables alignment and collision handling.
5. **Ownership is single-assignment** in `buildGraph`: a Pod belongs to at most one ReplicaSet, an RS to at most one Deployment (first match wins). Multi-match emission creates duplicate React Flow node IDs.
6. **Manual connections are always semantic or rejected** (`connectResources` / `explainInvalidLink`): Ingress↔Service sets the backend, Service↔workload/Pod sets the selector (creating an `app` label when missing), Deployment↔RS / RS↔Pod establishes ownership labels (renders as nesting, not an edge), Deployment↔Pod auto-corrects to RS adoption, HPA↔Deployment/ReplicaSet sets `spec.scaleTargetRef`. Pairs with no K8s meaning (e.g. Ingress↔Pod, HPA↔Service) are rejected with an error toast (`notice` in the store) — never draw a cosmetic edge that isn't in the model. Connections to synthetic nodes are redirected to their `managedBy` owner.
7. **Inferred edges are pure visuals**: `deletable: false, selectable: false, interactionWidth: 0`. React Flow z-elevates edges that reach nested pods above top-level nodes, and any fat hit-area swallows clicks on nodes/handles the edge crosses. For the same reason, strip `selected` before persisting user edges and keep `elevateEdgesOnSelect={false}`.
8. **Never leave the model invalid**: empty or duplicate `kind+name` names are rejected at the store level and surfaced inline in the inspector/modal. Renaming a Service cascades into Ingress backend references, renaming a Deployment/ReplicaSet cascades into HPA `scaleTargetRef`s.
9. **Invalid YAML never wipes the canvas** — `setYaml` keeps the last good graph and sets `yamlError`; on boot, unparseable saved YAML yields an empty canvas + error badge (never a graph that disagrees with the visible text).
10. **Synthetic resources never reach YAML or mutations** — `toResources` filters `data.synthetic`; `updateNodeFromCanvas`/`updateNodeResourceFromCanvas`/`deleteNodeFromCanvas` guard them with a toast; keyboard-deleting one just lets the rebuild re-materialize it (the "controller recreated it" toast). In `addCanvasEdge`, resource indices come from the *filtered* real-node list — node index ≠ resource index anymore.
11. **Auto-placed workloads must clear pinned ones** (`autoPlaceWorkload` + `fixedWorkloadSpans` in buildGraph). Positioned nodes don't advance the lane cursor, so without the overlap sweep every new workload stacks at x=50 over existing nodes and buries their connection handles.
12. **Leaf node boxes must fit their content** (`POD_HEIGHT`/`SERVICE_HEIGHT`/`INGRESS_HEIGHT` + `.k8s-node--leaf` overflow clip). Overflowing pod bodies used to spill past the parent Deployment's bottom edge and cover its source handle, silently breaking connection drags.
13. **HPA bounds beat `spec.replicas`** (`applyHpaReplicaOverrides` in buildGraph, run at the top of `commitResources`, `setYaml`, boot, and `resetLayout`). A targeted workload's `spec.replicas` is clamped into the HPA's `[minReplicas ?? 1, maxReplicas ?? ∞]` window and the clamped value is WRITTEN BACK — YAML, canvas pod count, and badges all agree. A Deployment's HPA propagates its effective count to the ReplicaSets it owns. First matching HPA wins per workload. Overrides are surfaced in `hpaOverrides` (the persistent bottom status bar in Canvas) only when a clamp actually changed a count; the clamp itself stays encoded in the rewritten `spec.replicas`.

## Conventions

- 4-space indentation in `src/` (components/store/utils), 2-space in CSS; single quotes.
- Styling is plain CSS in [src/index.css](src/index.css), BEM-ish class names (`k8s-node__header`, `inspector-field--invalid`), kind accent colors via the `--kind-color` custom property.
- `KIND_COLORS`/`KIND_ICONS` are duplicated across Canvas, K8sNode, and CreateResourceModal — keep them in sync if you touch one.
- Inspector fields that reference other resources must be populated from the live model (selects/datalists derived from `nodes`), not free text.

## Known accepted limitations

- Renaming a resource in the YAML editor is indistinguishable from delete+add, so manual edges attached to it are dropped (by design).
- Semantic links can't be "unlinked" from the canvas; edit the selector/backend/scaleTargetRef in the inspector or YAML instead.
- HPA never simulates CPU-based scaling (no metric-driven autoscaling): the workload's Pod count follows its clamped replicas, not live metrics. But HPA *does* enforce replica priority — see invariant 13.
- Pod materialization is capped at `MAX_SYNTHETIC_PODS` (15) per ReplicaSet to keep huge replica counts renderable; the replica badge always shows the true desired count.
- Selector dropdowns only model single-key `app` selectors; multi-key selectors written in YAML still match/nest correctly but editing them via the inspector collapses them to `app`.
