# Caishen

Caishen is a Next.js app for personal budgeting, shared expenses, and daily money review.

- Create persistent project documentation only when the user explicitly requests it.
- For every UI fix, show the user the running local dev server with the fix in place.
- Before finishing, delete one-off scripts and temporary artifacts created for the task, including ignored and untracked files.
- "Clean up" means: stop servers you started, remove task worktrees, and delete merged or pushed local branches.

`npm run check` runs ESLint and TypeScript together. Discover other commands in [package.json](package.json).

Read the relevant guides before doing that work:

- Implementing application changes or changing repository tooling: [Development](docs/agents/development.md).
- Changing how budgeting works: [Budgeting](docs/agents/budgeting.md).
- Building or changing UI, or running E2E tests: [UI review and E2E approval](docs/agents/ui-review.md).
- Writing or changing tests: [Testing](docs/agents/testing.md).
