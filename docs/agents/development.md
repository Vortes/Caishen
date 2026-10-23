# Development

## Discover the implementation

Trace the capability being changed from its entry point through the relevant behavior, persistence, and existing coverage. Record the facts needed for this task in the plan; let the inspected code determine the map.

For request handling and persistence, start looking in `src/server/` and `src/app/`. tRPC connections may lead through `src/trpc/`. Follow imports and callers to find the actual boundaries rather than assuming these hints are exhaustive.

## Extend the existing project

- Put application code under `src/`, tests under `tests/`, and requested documentation or reference material under `docs/`, rather than creating parallel top-level folders.
- Keep tool entry points and configuration at the root, including package manifests, Next.js, TypeScript, ESLint, PostCSS, Prettier, Playwright, Neon, and Vercel configuration. Keep local environment files there and never commit secrets.
- Keep only reusable development and maintenance commands in `scripts/`.
- Keep dependencies, build output, test output, and caches ignored.

## Work with persistence

- Import the generated Prisma client through `~/generated/prisma`. Regenerate it instead of editing generated files in `src/generated/prisma/`.
- Preserve database migration history when removing unused application code.

## Requested documentation

Do not preserve the introductory product brief as a project document.
