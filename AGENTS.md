# Repository rules

- Do not use the no-mistakes skill, CLI, or pipeline, including for validation, commits, pushes, or deployments.
- Do not generate documentation unless the user explicitly requests it.
- Do not preserve the introductory product brief as a project document.
- Delete one-off scripts and their temporary artifacts before finishing each task, including ignored and untracked files. Keep only reusable development and maintenance commands in `scripts/`.

## UI review before end-to-end tests

1. Finish the proposed UI, then present it to the user in the live app shell with a link directly to the feature, screenshots of the changes, and brief notes on what to try.
2. Wait for the user's explicit sign-off to run end-to-end tests for that presented version. Do not run E2E tests during UI iteration or before this approval, including targeted Playwright specs, full suites, or tests launched by delegated agents or CI. A general instruction to build or verify a feature is not E2E approval.
3. Before sign-off, prepare test changes and use type checking, linting, formatting, relevant unit tests, production builds, and manual browser inspection as needed. Browser automation for inspection or review screenshots is allowed; do not use it to execute E2E scenarios before approval.
4. After sign-off, run the agreed E2E coverage and necessary failure reruns. Test-only fixes and reruns against unchanged UI remain covered by that approval. If the UI changes, present the updated version and obtain renewed sign-off before more E2E tests.
5. Include this approval gate, current approval status, presented version, and approved coverage in delegated tasks and handoffs. Until approval arrives, report E2E verification as pending user sign-off.

## Project structure

```text
src/
  app/                 Next.js pages, layouts, and HTTP routes
  components/          React interface components
  domain/              Deterministic accounting model and operations
  server/              Database access, tRPC API, services, and integrations
  generated/prisma/    Generated Prisma client; ignored by version control
  styles/              Global styles and theme
  trpc/                Client-side tRPC and query configuration
tests/
  domain/              Accounting scenario tests
  server/              Server helper and webhook tests
  integrations/        Provider adapter and reconciliation tests
  database/            Neon persistence and authorization tests
  e2e/                 Playwright browser tests
prisma/
  schema.prisma        Database schema and client generator configuration
  migrations/          Versioned database migration history
docs/
  GLOSSARY.md          Budgeting terminology and accounting rules
  design-system/       Design tokens and component rules, starting at DESIGN.md
  architecture-decision-records/  Existing architecture decisions
  ynab-indexes/        YNAB source references, including ynab-links.md
public/                Static assets served directly by Next.js
scripts/               Development and maintenance commands
```

- Put application code under `src/`, all tests under `tests/`, and requested documentation or reference material under `docs/`. Use these directories instead of adding parallel top-level folders.
- Keep tool entry points at the root: package manifests, Next.js, TypeScript, ESLint, PostCSS, Prettier, Playwright, Neon, and Vercel configuration. Keep local environment files there and never commit secrets.
- Prisma generates its client in `src/generated/prisma/`. Import it through `~/generated/prisma` in application code; regenerate it instead of editing generated files.
- Keep dependencies, build output, test output, and caches ignored. TypeScript's incremental cache belongs in `.next/cache/`; these generated artifacts are not source files to reorganize manually.
- Preserve database migration history when removing unused application code. Moving files does not require a database migration.
- Before building or changing UI, read `docs/design-system/DESIGN.md` and the topic file for each component you use.
- Before changing budgeting behavior, read `docs/GLOSSARY.md` and the relevant decisions in `docs/architecture-decision-records/`. YNAB reference links are in `docs/ynab-indexes/ynab-links.md`.
