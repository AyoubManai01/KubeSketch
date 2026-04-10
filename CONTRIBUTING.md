# Contributing to Veltra

Thanks for your interest in contributing to Veltra.  
Veltra is built in the open, and we welcome improvements of all sizes - from typo fixes to major features.

## How to Contribute

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes with clear, focused commits
4. Push your branch to your fork
5. Open a pull request with context and screenshots (if UI changes)

Example workflow:

```bash
git clone https://github.com/<your-username>/veltra.git
cd veltra
git checkout -b feat/your-change
# make changes
git add .
git commit -m "feat: add node parser"
git push origin feat/your-change
```

## Development Setup

```bash
git clone https://github.com/<your-username>/veltra.git
cd veltra
npm install
npm run dev
```

Optional checks:

```bash
npm run build
npm run lint
```

## Code Guidelines

- Write code in **TypeScript**
- Keep modules focused and composable
- Prefer readable, predictable logic over clever shortcuts
- Keep UI and state logic cleanly separated when possible
- Add or update docs when behavior or workflows change

## Commit Convention

Use conventional-style commit messages:

- `feat: add node parser`
- `fix: resolve YAML parsing bug`
- `docs: improve getting started instructions`
- `refactor: simplify graph state handling`

## Pull Request Guidelines

- Describe the **why** and **what** in your PR description
- Link related issues when relevant
- Include screenshots or short recordings for UI changes
- Keep PRs small and focused (easier to review, faster to merge)
- Ensure local checks pass before requesting review

## Issues

Found a bug or have an idea?

- Open an issue with clear reproduction steps for bugs
- For feature requests, explain the use case and expected behavior
- Use descriptive titles and include any relevant logs/screenshots

We value respectful collaboration and constructive feedback.  
Thanks for helping shape Veltra.
