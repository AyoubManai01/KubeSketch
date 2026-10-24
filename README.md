<p align="center">
  <img src="./public/Logo-nobg.png" width="120" alt="KubeSketch logo" />
</p>

<h1 align="center">KubeSketch</h1>

<p align="center">
  <b>Design, understand, and evolve Kubernetes infrastructure visually — without losing YAML control.</b>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-blue.svg" alt="License: GPL-3.0" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs welcome" /></a>
</p>

> **NOTICE:** KubeSketch is an independent open-source project under active
> development — expect rough edges and frequent changes on the way to a stable
> release. KubeSketch is **not** a CNCF project, and is not affiliated with,
> sponsored, or endorsed by the CNCF, the Linux Foundation, or the Kubernetes
> project.

KubeSketch is a visual Kubernetes IDE that keeps your YAML and infrastructure
canvas in sync.

KubeSketch was created to blend the raw power of Kubernetes manifests with a
visual modeling experience — so you never have to choose between code and
diagrams, and the two sides never drift apart.

<div align="center">
  <video src="./public/demo.mp4" controls muted loop width="80%"></video>
</div>

## Features

- Vendor-independent / generic Kubernetes UI — works with any multi-document manifest
- **YAML stays the single source of truth** — the manifest and canvas are kept in sync, in both directions
- Visual architecture mapping with inferred relationships (selectors, backends, references, ownership)
- **Controller simulation** — see the ReplicaSets, Pods, and Jobs Kubernetes would materialize
- **Semantic drag-and-drop linking** — draw a connection and KubeSketch writes real fields into the manifest
- Guided resource creation and an inspector with inline validation
- Namespace and cluster frames with an editable layout mode
- VSCode-style file explorer that projects the manifest into per-resource files
- Export the canvas as PNG or SVG
- Local-first — runs entirely in your browser, no backend, no cluster connection

## Supported resource kinds

<details>
<summary>Show the full list</summary>

Deployment, ReplicaSet, Pod, Service, Ingress, HorizontalPodAutoscaler,
VerticalPodAutoscaler, ConfigMap, Secret, PersistentVolumeClaim,
PersistentVolume, StorageClass, Job, CronJob, and Gateway API resources
(GatewayClass, Gateway, HTTPRoute, GRPCRoute, TCPRoute, TLSRoute, UDPRoute).

</details>

## Quickstart

If you want to design or explore a Kubernetes architecture, KubeSketch runs
entirely locally — there is nothing to deploy to your cluster.

**Prerequisites**

- **Node.js 20.19+ or 22.12+** (required by Vite 8) with **npm**
- **Git**
- A modern browser (Chrome, Firefox, Edge, or Safari)

**Run it locally**

```bash
git clone https://github.com/AyoubManai01/Veltra.git
cd Veltra
npm install
npm run dev
```

Open the URL printed in your terminal (usually `http://localhost:5173`). The
landing page links straight to the IDE — or go directly to `/ide`.

## Using KubeSketch

- The landing page is served at `/`; the IDE lives at `/ide`.
- Paste or type multi-document YAML into the editor — the canvas renders it
  immediately.
- Drag resources to arrange the architecture; draw connections between them
  to link them semantically.
- Select a resource to edit its fields in the inspector; changes are validated
  before they are committed.
- Use the toolbar to load the sample, reset the canvas layout, export the
  graph as PNG/SVG, or switch to the file explorer view.

For example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubesketch-api
  labels:
    app: kubesketch-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: kubesketch-api
  template:
    metadata:
      labels:
        app: kubesketch-api
    spec:
      containers:
        - name: api
          image: nginx:stable
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: kubesketch-api
spec:
  selector:
    app: kubesketch-api
  ports:
    - port: 80
      targetPort: 80
```

**Configuration**

KubeSketch is **local-first** and needs no configuration files or environment
variables:

- Everything runs in the browser; there is no backend and no cluster
  connection, so your manifests stay on your machine.
- Your manifest, canvas positions, manual links, namespace layout, and UI
  state are persisted in browser `localStorage`, so your work survives
  refreshes.
- To deploy a static build, note that the `/ide` route needs a rewrite rule
  (`/ide` → `/index.html`) on static hosts.

## Quick Start for Contributors

Want to hack on KubeSketch? We'd love your help!

Check out the [Contributing Guidelines](./CONTRIBUTING.md) for detailed
instructions on setting up your local development environment, running the
tests, and the pull request expectations.

```bash
git clone https://github.com/AyoubManai01/Veltra.git
cd Veltra
npm install
npm run dev      # Vite dev server at http://localhost:5173
npm run lint     # ESLint
npm run test     # Vitest suite
npm run build    # typecheck + production bundle
```

## How it works

YAML text, canvas nodes and edges, the inspector, and the file tree are all
projections of one resource model held in a Zustand store:

```
YAML text ──parseYaml──▶ K8sResource[] ──buildGraph──▶ nodes + inferred edges
     ▲                                                        │
     └──── resourcesToYaml ◀── toResources(nodes) ◀── canvas / inspector edits
```

- **YAML → canvas:** multi-document YAML is parsed into resources, then a
  graph builder produces nested, lane-laid-out nodes plus inferred edges for
  the relationships Kubernetes encodes.
- **Canvas → YAML:** every structural change funnels through a single commit
  path that rebuilds the graph and re-serializes the manifest, so the two
  sides never drift apart.
- **Synthetic resources** (materialized ReplicaSets, Pods, and Jobs) are
  display-only: they are filtered out before serialization, so they never
  appear in your YAML.

**Tech stack:** React + TypeScript, React Flow
([@xyflow/react](https://reactflow.dev/)), Monaco Editor
([@monaco-editor/react](https://github.com/suren-atoyan/monaco-react)), Zustand,
js-yaml, Vite, and Vitest.

## Get involved

Check out our:

- [Contributing Guidelines](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Security Policy](./SECURITY.md)

KubeSketch is an independent open-source project that follows community practices
inspired by established CNCF and open-source projects. KubeSketch has adopted the
[CNCF Code of Conduct](https://github.com/cncf/foundation/blob/main/code-of-conduct.md)
for its community guidelines. KubeSketch is **not** a CNCF project: it is not
hosted, sponsored, or endorsed by the CNCF or the Linux Foundation, and no
such affiliation is claimed.


## License

KubeSketch is released under the terms of the
[GNU General Public License, version 3 (GPL-3.0)](./LICENSE).

Copyright © 2026 [Ayoub Manai](https://github.com/AyoubManai01)

## Frequently Asked Questions

**Does KubeSketch connect to my cluster?**

Yes, we can deploy KubeSketch on your cluster. The project is still in its early phases, so fill the form on our website to reserve your spot and we will contact you!

**Where is my data stored?**

In your browser's `localStorage` on your own machine. KubeSketch has no backend
and sends nothing to a server.

**Which Kubernetes resources does KubeSketch understand?**

See the [supported resource kinds](#supported-resource-kinds) listed above —
workloads, networking (including Gateway API), storage, configuration, and
autoscaling.

## Acknowledgements

KubeSketch is built on wonderful open-source projects, including
[React](https://react.dev/), [React Flow](https://reactflow.dev/),
[Monaco Editor](https://microsoft.github.io/monaco-editor/),
[Zustand](https://zustand.docs.pmnd.rs/), [js-yaml](https://github.com/nodeca/js-yaml),
[Vite](https://vite.dev/), and [Vitest](https://vitest.dev/). Thank you to
their maintainers and contributors.
