# Repository rules

- Do not use the no-mistakes skill, CLI, or pipeline, including for validation, commits, pushes, or deployments.
- Do not generate documentation unless the user explicitly requests it.
- Do not preserve the introductory product brief as a project document.

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
- Before changing budgeting behavior, read `docs/GLOSSARY.md` and the relevant decisions in `docs/architecture-decision-records/`. YNAB reference links are in `docs/ynab-indexes/ynab-links.md`.
