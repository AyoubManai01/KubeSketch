# Contributing to Veltra

Thanks for your interest in contributing to Veltra! 🎉

Veltra is an independent open-source Kubernetes visual IDE, and we welcome
improvements of all sizes — from typo fixes and documentation updates to bug
fixes and major features. This guide keeps the contribution process simple and
approachable.

New contributors are welcome. If you are unsure where to start, look for
issues labeled `good first issue`, or ask a question in an issue — there are no
silly questions.

## Prerequisites

- **Node.js 20.19+ or 22.12+** (required by Vite 8) and **npm**
- **Git** and a **GitHub account**
- A modern browser (Chrome, Firefox, Edge, or Safari)
- Familiarity with TypeScript and React is helpful; familiarity with
  Kubernetes manifests is helpful for feature work, but not required to get
  started

## Setting up the development environment

```bash
git clone https://github.com/AyoubManai01/Veltra.git
cd Veltra
npm install
```

## Running Veltra locally

Start the Vite development server:

```bash
npm run dev
```

Then open the local URL printed in your terminal (usually
`http://localhost:5173`).

- The landing page is served at `/`.
- The IDE itself lives at `/ide`.
- To open the IDE with the bundled sample manifest preloaded, visit
  `/ide?sample=1`.

You can also typecheck and build a production bundle:

```bash
npm run build
```

and preview it locally:

```bash
npm run preview
```

> Note: Vite's dev server and `vite preview` fall back to `index.html` for the
> `/ide` route. A static host needs a rewrite rule (`/ide` → `/index.html`).

## Testing

Veltra uses [Vitest](https://vitest.dev/) with a jsdom environment. Tests live
under `src/tests/`, grouped by area (`utils/`, `store/`, `components/`), with
the shared setup in `src/tests/setup.ts`.

```bash
npm run test          # run the full suite once
npm run test:watch    # watch mode, re-runs on changes
npm run test:coverage # run with coverage reporting
```

Please add or update tests when you change behavior. Utility tests cover the
manifest → graph pipeline (parsing, graph building, layout, and reference
resolution); component tests cover the editor, canvas, and modals.

## Linting and style

```bash
npm run lint
```

Linting is done with ESLint (flat config in `eslint.config.js`). There is no
separate code formatter configured, so please match the existing conventions:

- TypeScript (with JSX) throughout
- 4-space indentation in `src/`, 2-space in CSS
- Single quotes
- Plain CSS in `src/styles/`, loaded from `src/index.css`, with BEM-style
  class names (e.g. `k8s-node__header`, `inspector-field--invalid`)

## Creating issues

Found a bug or have an idea? Issues are the best place to start.

For **bug reports**, please include:

- What you did and what happened
- What you expected to happen instead
- Steps to reproduce, ideally with a minimal Kubernetes manifest
- Your environment (browser, Node.js version, commit or release)

For **feature requests**, explain the use case and the expected behavior —
what problem would this solve for you?

Use descriptive titles and include relevant logs or screenshots when helpful.

## Proposing features

For anything larger than a small fix, open an issue to discuss the idea
**before** writing much code. Early feedback saves everyone time and helps
align the design with Veltra's model (the manifest as the single source of
truth). Bug fixes and small improvements don't need prior discussion.

## Pull request expectations

1. Fork the repository.
2. Create a feature branch from `main`.
3. Make your changes with clear, focused commits.
4. Push your branch to your fork.
5. Open a pull request with context and screenshots (if UI changes).

Good pull requests:

- Describe the **why** and the **what** in the PR description
- Link related issues when relevant
- Include screenshots or short recordings for UI changes
- Keep changes small and focused — easier to review, faster to merge
- Ensure `npm run lint`, `npm run test`, and `npm run build` pass before
  requesting review

Example workflow:

```bash
git clone https://github.com/<your-username>/Veltra.git
cd Veltra
git checkout -b feat/your-change
# make changes
git add .
git commit -m "feat: add node parser"
git push origin feat/your-change
```

## Commit expectations

Use conventional-style commit messages:

- `feat: add node parser`
- `fix: resolve YAML parsing bug`
- `docs: improve getting started instructions`
- `refactor: simplify graph state handling`
- `test: cover PVC mount linking`

Keep commits focused on a single change so the history stays readable.

## Code and documentation quality

- Write code in TypeScript.
- Keep modules focused and composable.
- Prefer readable, predictable logic over clever shortcuts.
- Keep UI and state logic cleanly separated where possible.
- Update documentation when behavior or workflows change.

## Code of Conduct

All participants in the Veltra community are expected to follow our
[Code of Conduct](./CODE_OF_CONDUCT.md). We value respectful collaboration and
constructive feedback.

## Security issues

If you find a potential security vulnerability, please do **not** open a public
issue. See [SECURITY.md](./SECURITY.md) for how to report it privately.

Thanks for helping shape Veltra!
