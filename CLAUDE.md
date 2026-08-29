# CLAUDE.md

Veltra is a Kubernetes Visual IDE: a split-screen app with a Monaco YAML editor (left) and a React Flow resource canvas (right), kept in bidirectional sync. Supported resource kinds: Deployment, ReplicaSet, Pod, Service, Ingress, HPA (HorizontalPodAutoscaler), ConfigMap, PersistentVolumeClaim (PVC), PersistentVolume (PV), StorageClass, Secret, Job, CronJob, VerticalPodAutoscaler (VPA).

The canvas simulates Kubernetes controllers: a Deployment with no matching ReplicaSet in the manifest gets a **synthetic** RS (named `<name>-<hash>`, deterministic), and every RS (real or synthetic) materializes Pods up to `spec.replicas` on top of any explicit Pods its selector claims. A CronJob always synthesizes exactly one **own** Job (named `<name>-<hash>`) from `spec.jobTemplate.spec`, which materializes Pods up to the template's `parallelism` — CronJobs never claim existing Jobs or Pods. Synthetic nodes carry `data.synthetic: true` + `data.managedBy` (nearest real owner) and are display-only.

## Commands

```bash
npm run dev      # Vite dev server → http://localhost:5173/
npm run build    # tsc -b && vite build (typecheck + bundle)
npm run lint     # eslint
npm run test     # vitest run (buildGraph utils + component tests)
```

Verify changes by driving the running app in a browser — see `.claude/skills/verify/SKILL.md` for the full recipe and its gotchas (localStorage reset, clipboard-paste into Monaco, handle-drag connections). Note: the Canvas component tests currently fail on the `@xyflow/react` mock (missing `useReactFlow` export, pre-existing); the buildGraph/util tests (`job.test.ts`, `cronjob.test.ts`, `storage.test.ts`, `secrets.test.ts`, `hpaOverrides.test.ts`, `vpa.test.ts`) are the meaningful suite.

## Architecture

Single source of truth: the Zustand store ([src/store/store.ts](src/store/store.ts)). YAML text, canvas nodes/edges, the inspector, and relationships are all projections of one resource model.

Data flow:

```
YAML text ──parseYaml──▶ K8sResource[] ──buildGraph──▶ nodes + inferredEdges
     ▲                                                        │
     └──── resourcesToYaml ◀── toResources(nodes) ◀── canvas/inspector edits
```

- [src/utils/parseYaml.ts](src/utils/parseYaml.ts) — multi-doc YAML → filtered `K8sResource[]`.
- [src/utils/buildGraph.ts](src/utils/buildGraph.ts) — resources → React Flow nodes (nested containment: Pod ⊂ ReplicaSet ⊂ Deployment; Jobs and CronJob→Job→Pod are sibling groups linked by inferred edges) + inferred edges (ingress backends, service selectors, HPA scaleTargetRefs, VPA targetRefs, cron triggers/job owns), plus lane-based auto-layout and collision resolution.
- [src/utils/linkResources.ts](src/utils/linkResources.ts) — semantic meaning of manual canvas connections (writes selectors/labels/backends into the model).
- [src/utils/serializeYaml.ts](src/utils/serializeYaml.ts) — resources → YAML (`skipInvalid: true`).
- [src/utils/k8sScope.ts](src/utils/k8sScope.ts) — `CLUSTER_SCOPED_KINDS` (PersistentVolume, StorageClass) + `isClusterScoped(kind)`.
- [src/utils/teachingFrame.ts](src/utils/teachingFrame.ts) — cluster/namespace bounding frames: `buildTeachingFrame` (auto-derive from top-level nodes; cluster-scoped kinds never join a namespace rect), `effectiveNsLayout` (persisted layout ∪ auto-discovered namespaces), `rectContains`.
- [src/components/NsFrame.tsx](src/components/NsFrame.tsx) — renders the frames inside a `ViewportPortal`; in NS editing mode they get pointer drag/resize surfaces (8 handles each). Drag deltas are cumulative and events bubble through the outer frame, so only the pointer-captured element may apply a move (guard: `drag.el === e.currentTarget`), and the store diffs absolute rects against its own layout instead of adding deltas.
- [src/components/Canvas.tsx](src/components/Canvas.tsx) — canvas + node inspector. [src/components/YamlEditor.tsx](src/components/YamlEditor.tsx) — Monaco + selected-resource highlight. [src/components/CreateResourceModal.tsx](src/components/CreateResourceModal.tsx) — resource creation with validation.

localStorage keys: `veltra_yaml`, `veltra_user_edges`, `veltra_node_positions`, `veltra_ns_layout`, `veltra_file_explorer`, `veltra_active_file`, `veltra_explorer_split`.

## File explorer mode

The toolbar's "Files" toggle swaps the editor pane for a VSCode-style explorer
sidebar + a per-file Monaco editor. **The manifest stays ONE YAML document**
(`veltra_yaml`) — the file tree is a pure projection ([src/utils/fileTree.ts](src/utils/fileTree.ts)):
`buildFileExplorer(nodes)` → `{ tree, fileOf }` where `fileOf` maps every real
resource to its virtual path, computed from the reference graph (same helpers
`buildGraph` uses). App-centric layout:

- `cluster/<storage-classes|persistent-volumes|gateway-classes>/<name>.yaml` —
  cluster-scoped kinds, one file per resource.
- `<namespace>/<app>/` — an app is a workload (Deployment/ReplicaSet/Pod/Job/
  CronJob) sharing `labels.app` (fallback `app.kubernetes.io/name`, then its
  name) plus everything its reference graph pulls in (Service selector match,
  Ingress backends + TLS Secrets, HPA/VPA targets, ConfigMap/Secret/PVC pod-spec
  refs, Gateway API Routes backing its Services). Files are one resource kind:
  `deployment.yaml` bundles the Deployment + its HPA + VPA, etc.
- `<namespace>/_gateway/<name>.yaml` — Gateways (shared infra, never app-bound).
- `<namespace>/_misc/<kind>.yaml` — orphans grouped by kind.

Assignment is **single and deterministic** (first app wins in sorted
(namespace, app) order; workloads are pre-claimed so they never fall to `_misc`).
A Secret used by a pod spec goes to `secret.yaml`; a TLS-only Secret stays with
its Ingress in `ingress.yaml`. Reusing these rules keeps the tree stable across
commits.

Sync: `setActiveFile`/`setFileYaml` in the store. `setFileYaml` re-parses only
the file's slice, removes its current members (via `fileOf`), merges the result
back into the manifest and commits through `commitResources` — so invariants 2,
9 (invalid file YAML → `fileYamlError`, canvas untouched), 10 and 13 all hold
scoped. `commitResources`/`setYaml`/`resetLayout` re-validate `activeFile`
against the new tree and re-serialize `activeFileText` (the file view follows
canvas/inspector edits); `setFileYaml` keeps the raw typed text in the editor
while typing. Selecting a canvas node opens its containing file (effect in
FileExplorerView). Renames typed in a file keep the same delete+add semantics
as the full-manifest editor. `veltra_active_file`/`veltra_file_explorer` persist
the mode and last-opened file; `veltra_explorer_split` is the sidebar width %.

## Namespace editing mode

The toolbar's "Namespaces" toggle enters NS editing mode, where the decorative
Cluster/`ns:` bounding frames become editable:

- **Drag a namespace rect** → its contained top-level nodes translate with it
  (nested children follow via their parent). **Drag the cluster rect** → every
  top-level node (namespaced AND cluster-scoped) plus all namespace rects move.
  Resize via the 8 handles on each rect (nodes never move on resize).
  Rectangles can never overlap each other: the store clamps every move/resize
  (`resolveMoveCollision`/`resolveResizeCollision` — the dragged rect is pushed
  out along the axis of least penetration; growth stops at a neighbor's facing
  edge) and even the add-namespace placement is collision-resolved. A resize
  can never shrink past a contained resource either (each edge stops at its
  content's facing edge, so a resource is never left outside its box), and a
  namespace box can never extend outside the cluster box (edges are clamped to
  the cluster while the box overlaps it — a west/north clamp re-anchors the
  opposite edge so the box never grows from the wrong side into a neighbor).
  Symmetrically, the cluster box can't shrink past its namespace boxes
  (`resizeClusterRect` clamps the namespace rects as content).
- **"+ Namespace"** opens a modal (like the resource creation prompts, not a
  native alert) — inline validation for empty/duplicate names (against both
  persisted rects and namespaces discovered from the graph) and a default-size
  empty rect dropped below the cluster on confirm.
- **Resources are fixed in place**: a node drag is a *reassignment attempt* —
  on drop the node snaps back to its pre-drag position and, if the **pointer**
  (not the node centroid — large workloads dwarf their target rects) is inside
  another namespace rect, `updateNodeFromCanvas({namespace})` reassigns it.
  When a reassignment happens the node is repositioned **inside the target
  rect** (pointer-anchored, clamped to its interior) and that position is
  pinned, so the move is visible on the canvas instead of snapping back. The
  drop target is the SMALLEST rect containing the pointer (auto-derived rects
  can overlap when one namespace's workload surrounds another's). Synthetic
  nodes and cluster-scoped kinds can't be reassigned. Dragging is disabled
  per-node for cluster-scoped kinds in NS mode, and `autoPanOnNodeDrag` is off
  so the view never shifts mid-drop.
- **Normal mode is boundary-enforcing**: while dragging, namespaced nodes are
  clamped inside their namespace box and cluster-scoped kinds are pushed out of
  every namespace box (`clampDraggedNode` in Canvas, run live in `onNodeDrag`
  and once more on drop — React Flow emits a final unclamped position change
  after the last `onNodeDrag`, so the drop re-clamps against the layout
  captured at drag start; all reads go through `useVeltraStore.getState()`
  because React batches re-renders and the render-scope nodes are one frame
  stale during a drag).
- **Persistence**: `veltra_ns_layout` is written only when leaving NS mode AND
  the layout was actually edited. `nsLayout` starts `null` — `effectiveNsLayout`
  then derives everything from the live graph, so YAML changes always re-hug
  the frames; edit actions lazily seed `nsLayout` from the graph via
  `ensureNsLayout` in the store.
- **Cluster-scoped kinds** (PV/StorageClass) render inside the cluster rect but
  OUTSIDE any namespace rect; the create modal and the inspector hide the
  Namespace field for them, and `updateNodeFromCanvas`/`handleValidate` strip a
  stale namespace.

## Invariants — do not break these

They each encode a fixed bug; regressing one reintroduces it.

1. **Node IDs are `Kind-name`** (`nodeIdFor`). Renames change the ID, so any rename path must remap `userEdges`, migrate the stored position key, and update the selection. Selection is stored as `{kind, name}` (`selectedResource`) in the store — never hold a node ID in component state (that's what used to close the inspector mid-rename).
2. **All structural mutations funnel through `commitResources`** in the store (rebuild graph → merge edges → serialize YAML only when sync is on). Don't add parallel update paths.
3. **Dragging never touches YAML.** Positions aren't part of YAML; serializing on drag destroys user comments/formatting. Position/selection/dimension changes go through `setCanvasNodesPositionOnly` (a bare `set({nodes})`).
4. **Only user-dragged nodes get pinned** (`persistNodePositions(draggedIds)` on drag stop). Persisting auto-layout positions on commits permanently disables alignment and collision handling.
5. **Ownership is single-assignment** in `buildGraph`: a Pod belongs to at most one ReplicaSet, an RS to at most one Deployment (first match wins). Multi-match emission creates duplicate React Flow node IDs.
6. **Manual connections are always semantic or rejected** (`connectResources` / `explainInvalidLink`): Ingress↔Service sets the backend, Service↔workload/Pod sets the selector (creating an `app` label when missing), Deployment↔RS / RS↔Pod establishes ownership labels (renders as nesting, not an edge), Deployment↔Pod auto-corrects to RS adoption, HPA↔Deployment/ReplicaSet sets `spec.scaleTargetRef`, ConfigMap↔Pod/Deployment/ReplicaSet/Job/CronJob writes a configmap reference (`envFrom`/`env.valueFrom`/`volumes` into the Pod spec or the workload's pod template — for a CronJob that's `spec.jobTemplate.spec.template.spec`; the mechanism is chosen in a post-drag prompt, `pendingConfigMapLink`, before committing; it renders as an inferred cyan "uses" edge, not nesting), Secret↔Pod/Deployment/ReplicaSet/Job/CronJob writes a secret reference the same way (`envFrom[].secretRef`/`env[].valueFrom.secretKeyRef`/`volumes[].secret.secretName` via the `pendingSecretLink` mechanism prompt, rendering as an inferred red "uses" edge), Ingress↔Secret writes `spec.tls[].secretName` with a hosts list chosen in the `pendingIngressTlsLink` prompt (renders as an inferred amber "tls" edge). CronJob↔Job is rejected — a CronJob creates its own Job. Pairs with no K8s meaning (e.g. Ingress↔Pod, HPA↔Service, ConfigMap↔Service/Ingress/HPA/ConfigMap, Secret↔Service/HPA/ConfigMap/Secret) are rejected with an error toast (`notice` in the store) — never draw a cosmetic edge that isn't in the model. Connections to synthetic nodes are redirected to their `managedBy` owner.
7. **Inferred edges are pure visuals**: `deletable: false, selectable: false, interactionWidth: 0`. React Flow z-elevates edges that reach nested pods above top-level nodes, and any fat hit-area swallows clicks on nodes/handles the edge crosses. For the same reason, strip `selected` before persisting user edges and keep `elevateEdgesOnSelect={false}`.
8. **Never leave the model invalid**: empty or duplicate `kind+name` names are rejected at the store level and surfaced inline in the inspector/modal. Renaming a Service cascades into Ingress backend references, renaming a Deployment/ReplicaSet cascades into HPA `scaleTargetRef`s, renaming a Secret cascades into Pod-spec references (`envFrom[].secretRef`/`env[].valueFrom.secretKeyRef`/`volumes[].secret.secretName`) and Ingress `spec.tls[].secretName`.
9. **Invalid YAML never wipes the canvas** — `setYaml` keeps the last good graph and sets `yamlError`; on boot, unparseable saved YAML yields an empty canvas + error badge (never a graph that disagrees with the visible text).
10. **Synthetic resources never reach YAML or mutations** — `toResources` filters `data.synthetic`; `updateNodeFromCanvas`/`updateNodeResourceFromCanvas`/`deleteNodeFromCanvas` guard them with a toast; keyboard-deleting one just lets the rebuild re-materialize it (the "controller recreated it" toast). In `addCanvasEdge`, resource indices come from the *filtered* real-node list — node index ≠ resource index anymore.
11. **Auto-placed workloads must clear pinned ones** (`autoPlaceWorkload` + `fixedWorkloadSpans` in buildGraph). Positioned nodes don't advance the lane cursor, so without the overlap sweep every new workload stacks at x=50 over existing nodes and buries their connection handles.
12. **Leaf node boxes must fit their content** (`POD_HEIGHT`/`SERVICE_HEIGHT`/`INGRESS_HEIGHT` + `.k8s-node--leaf` overflow clip). Overflowing pod bodies used to spill past the parent Deployment's bottom edge and cover its source handle, silently breaking connection drags.
13. **HPA bounds beat `spec.replicas`** (`applyHpaReplicaOverrides` in buildGraph, run at the top of `commitResources`, `setYaml`, boot, and `resetLayout`). A targeted workload's `spec.replicas` is clamped into the HPA's `[minReplicas ?? 1, maxReplicas ?? ∞]` window and the clamped value is WRITTEN BACK — YAML, canvas pod count, and badges all agree. A Deployment's HPA propagates its effective count to the ReplicaSets it owns. First matching HPA wins per workload. Overrides are surfaced in `hpaOverrides` (the persistent bottom status bar in Canvas) only when a clamp actually changed a count; the clamp itself stays encoded in the rewritten `spec.replicas`.
14. **Storage is explicit-only, single-binding, mount-aware**: PVCs/PVs/StorageClasses get lanes below ConfigMaps and never synthesize (no controller simulation — a missing PVC/PV/StorageClass target draws no edge). A PVC binds to exactly ONE target: `spec.volumeName` → PV or `spec.storageClassName` → StorageClass (volumeName wins for edge drawing). Every write of one field clears the other (`linkPvcToPv`/`linkPvcToStorageClass`, the PVC inspector's two binding selects, and the create modal's bind picker) so the model never holds both. PVCs mount into Pods **or workloads** (`volumes[].persistentVolumeClaim.claimName`; Deployments/ReplicaSets get the reference in `spec.template.spec` via `linkPvcToWorkload`): PVC↔Pod/Deployment/ReplicaSet drags pause in a volume-name prompt (`pendingPvcLink`/`confirmPvcLink`/`PvcLinkModal`) and the create modal's "Mount into" picker lists all three kinds (synthetic Pods resolve to their workload owner). A **single-node** claim (ReadWriteOnce/ReadWriteOncePod — `isSingleNodeAccessMode`) is DENIED for workloads running more than one replica (`replicasOf`), in the store's drag interceptor, the create modal, **and the PVC inspector's Access Modes select (inline error, commit blocked via `pvcAccessModeViolation` in Canvas)** — identical replicas can't share a single-node volume. The same guard covers Job `parallelism` and CronJob `jobTemplate` parallelism (`parallelismOf`/`cronParallelismOf`). PV/StorageClass↔anything-but-PVC is rejected. Renaming a PVC cascades into Pod-spec and workload pod-template claims, renaming a PV into `pvc.spec.volumeName`, renaming a StorageClass into `pvc.spec.storageClassName`. Inferred edges: pod→PVC "mounts" (pink, target-colored), PVC→PV "binds" (lime), PVC→SC "binds" (indigo).
15. **CronJobs own their Jobs single-assignment** (`synthesizeJob` in buildGraph): a CronJob always synthesizes exactly ONE Job (named `<name>-<hash>`) from `spec.jobTemplate.spec`, and that synthetic Job materializes Pods up to the template's `parallelism` — it NEVER claims existing Jobs or explicit Pods (real Jobs stay standalone). The Job and its Pods are top-level siblings of the CronJob (never nested) linked by inferred edges (`triggers` CronJob→Job, `owns` Job→Pod), all with `managedBy` pointing at the nearest REAL owner (the CronJob), so canvas links to them redirect to the CronJob and delete/rename guards behave like the Deployment's synthetic RS/Pods. They are **draggable like a real Job and its Pods** (positions persist and a pinned synthetic Job clears auto-placed workloads), but remain display-only — edits/deletes are still guarded. CronJob↔Job manual connections are rejected.
16. **VPAs target the pod controller, not its Pods** (`getVpaTarget` reads `spec.targetRef` — allowed kinds Deployment/ReplicaSet/Pod/Job/CronJob; a target whose Pods are nested inside a Deployment/ReplicaSet is addressed via the workload, never the nested Pods). The inferred edge is VPA→targetRef node labeled "right-sizes" (sky `#0ea5e9`), never to nested Pods. Manual VPA↔workload/Pod connections write `targetRef` via `linkVpaToTarget` — 1:1, an existing targetRef is replaced; synthetic targets redirect to their real owner. VPA↔Service/Ingress/HPA/ConfigMap/Secret/PVC/PV/StorageClass pairs are rejected with a toast. Renaming a Deployment/ReplicaSet/Pod/Job/CronJob cascades into VPA `targetRef.name` (`renameVpaTargetReferences` in the store). VPAs share HPA's lane (Y=520) with a SINGLE combined collision pass so the two autoscaler kinds never overlap. VPA has **no controller simulation**: it never rewrites container resources or replica counts on the canvas — the VPA inspector (`targetRef`, `updatePolicy.updateMode`, min/max cpu+memory via `resourcePolicy.containerPolicies[0]`) and the target's read-only "Vertical scaled by" projection (driven by `getVpaTarget`) stay in sync with the model. Kind token is the FULL `VerticalPodAutoscaler` (like PersistentVolumeClaim, unlike the short HPA token), `apiVersion: autoscaling.k8s.io/v1`.

## Conventions

- 4-space indentation in `src/` (components/store/utils), 2-space in CSS; single quotes.
- Styling is plain CSS in [src/index.css](src/index.css), BEM-ish class names (`k8s-node__header`, `inspector-field--invalid`), kind accent colors via the `--kind-color` custom property.
- `KIND_COLORS`/`KIND_ICONS` are duplicated across Canvas, K8sNode, and CreateResourceModal — keep them in sync if you touch one.
- Inspector fields that reference other resources must be populated from the live model (selects/datalists derived from `nodes`), not free text.

## Known accepted limitations

- Renaming a resource in the YAML editor is indistinguishable from delete+add, so manual edges attached to it are dropped (by design).
- Semantic links can't be "unlinked" from the canvas; edit the selector/backend/scaleTargetRef in the inspector or YAML instead.
- HPA never simulates CPU-based scaling (no metric-driven autoscaling): the workload's Pod count follows its clamped replicas, not live metrics. But HPA *does* enforce replica priority — see invariant 13.
- VPAs have no simulation either (like ConfigMaps/Secrets/storage): the "right-sizes" edge and the inspector projections are pure model views — a VPA never rewrites the target's container resources or replica count, and its `resourcePolicy` bounds are only written via the VPA inspector, create modal, drag, or YAML.
- Pod materialization is capped at `MAX_SYNTHETIC_PODS` (15) per ReplicaSet to keep huge replica counts renderable; the replica badge always shows the true desired count.
- Selector dropdowns only model single-key `app` selectors; multi-key selectors written in YAML still match/nest correctly but editing them via the inspector collapses them to `app`.
- ConfigMaps render in their own lane (below HPAs) and receive an inferred cyan "uses" edge from every workload whose Pod spec references them (via `envFrom`/`env.valueFrom`/`volumes.configMap`, under `spec` or `spec.template.spec`). ConfigMap↔Pod/Deployment/ReplicaSet manual connections are semantic: they pause in a post-drag mechanism prompt (`pendingConfigMapLink`) before writing the reference. ConfigMap↔Service/Ingress/HPA/ConfigMap connections are rejected with a toast. The Create ConfigMap modal can also link the new ConfigMap to one existing target (mechanism + data key pickers; synthetic Pod targets redirect to their real owner). The workload/Pod inspector lists "Config Maps" and the ConfigMap inspector lists "Used by" — both read-only projections; references are written only via the modal/drag/YAML. Renaming a ConfigMap cascades into those references.
- Storage has no controller simulation: a PVC with neither `storageClassName` nor `volumeName` stays unbound on the canvas, and PVC→PV/SC edges appear only when the target exists in the manifest. `spec.volumeName` beats `spec.storageClassName` for edge drawing, but the PVC inspector's selects always clear the opposite field so a PVC never holds both. PVC mounts are Pod **or workload** (Pod/Deployment/ReplicaSet): the Create PVC modal's "Mount into" picker lists real Pods, Deployments and ReplicaSets (synthetic Pods resolve to their workload owner), and dragging onto a workload pauses in the same volume-name prompt — but a single-node access mode (ReadWriteOnce/ReadWriteOncePod) on a workload with replicas > 1 is rejected with an error, both at creation/drag time and when the PVC inspector's Access Modes select tries to commit such a mode (the symmetric direction — scaling an existing workload to >1 replicas while a single-node PVC is mounted — is not blocked in the inspector; edit YAML or scale down first). The PV inspector shows "Bound to PVC" and the StorageClass inspector "Bound PVCs" — read-only projections of claims pointing at them.
- Secrets render in their own lane below StorageClasses (Y=1320) and receive an inferred red "uses" edge from every workload whose Pod spec references them (via `envFrom[].secretRef`/`env[].valueFrom.secretKeyRef`/`volumes[].secret.secretName`, under `spec` or `spec.template.spec`), plus an inferred amber "tls" edge from every Ingress whose `spec.tls[].secretName` points at them. Secret↔Pod/Deployment/ReplicaSet manual connections are semantic: they pause in a post-drag mechanism prompt (`pendingSecretLink`, with a volume-name input for the `volumes` mechanism and a data-key picker for `envKey`) before writing the reference. Secret↔Service/HPA/ConfigMap/Secret connections are rejected with a toast; Secret↔Ingress is valid but pauses in a hosts prompt (`pendingIngressTlsLink`). The Create Secret modal supports the same link-to-target UX as ConfigMap (mechanism + key/volume-name pickers; synthetic Pod targets redirect to their real owner) and the Create Ingress modal has an optional TLS Secret + hosts picker. The workload/Pod inspector lists "Secrets" and the Secret inspector lists "Used by"; the Ingress inspector has a read-only TLS section — all read-only projections; references are written only via the modal/drag/YAML. Secret data values are stored as-is (K8s expects base64 in `spec.data` — base64 encoding is the user's responsibility). Renaming a Secret cascades into Pod-spec references and Ingress `spec.tls[].secretName`.
- CronJobs render in the workload lane (Y=320) with their synthetic Job and the Job's Pods as top-level siblings (inferred "triggers"/"owns" edges). The synthetic Job and its Pods are **draggable like a real Job and its Pods** (positions persist; a pinned synthetic Job clears auto-placed workloads) but remain display-only — edits/deletes are still guarded. The Create CronJob modal sets `spec.schedule` (default `* * * * *`, validated as 5 fields or an @-descriptor), the Job template (`restartPolicy`, `parallelism`, `completions`) and the Pod (container name/image) — pods are described indirectly through the Job, like real Kubernetes. An optional shell command writes `command: ["/bin/sh","-c"]` + `args: ["<cmd>"]` on the first container (the CronJob inspector edits `args[0]` and keeps the command pinned). ConfigMap/Secret/PVC references land in `spec.jobTemplate.spec.template.spec` (`linkConfigMapToWorkload`/`linkSecretToWorkload`/`linkPvcToWorkload`), so the workload's "Config Maps"/"Secrets"/"PVCs" inspector lists and the reverse "Used by"/"Bound" projections include CronJobs, and the single-node PVC guard uses `cronParallelismOf`. A real Job matching a CronJob's name/labels is never claimed — the CronJob always creates its own.
