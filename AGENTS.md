# Caishen

Caishen is a Next.js app for personal budgeting, shared expenses, and daily money review.

- During planning, discover how the relevant capability works from current code and build just-in-time notes in the plan. Treat discovery paths as starting points, not a fixed directory map.
- Do not use the no-mistakes skill, CLI, or pipeline, including for validation, commits, pushes, or deployments.
- Create persistent project documentation only when the user explicitly requests it.
- Before finishing, delete one-off scripts and temporary artifacts created for the task, including ignored and untracked files.

`npm run check` runs ESLint and TypeScript together. Discover other commands in [package.json](package.json).

Read the relevant guides before doing that work:

- Implementing application changes or changing repository tooling: [Development](docs/agents/development.md).
- Changing how budgeting works: [Budgeting](docs/agents/budgeting.md).
- Building or changing UI, or running E2E tests: [UI review and E2E approval](docs/agents/ui-review.md).
- Writing or changing tests: [Testing](docs/agents/testing.md).
