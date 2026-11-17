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

## Sign in as the agent

To check a change in a running dev server yourself, sign in as the shared agent login: `caishen-agent+clerk_test@example.com`, then the code `424242`. It's a Clerk test address in the development instance, so no email is sent and production refuses it. Use a private browser profile so the user's own session stays signed in.

Its data is the seed's demo household (Alex and Jordan) on dev-caishen, so every worktree branch from `npm run db:worktree` already has it. To rebuild it, run `npm run db:seed -- --user user_3LcjYOqPPgKtT9fQ0vB4nNuEBcN --reset` against dev-caishen from main.

## Requested documentation

Do not preserve the introductory product brief as a project document.

## Sandbox smoke test

`npm run test:sandbox` runs the real Chase Sandbox API smoke scenario on this worktree's Neon branch. It requires `PLAID_SANDBOX_CLIENT_ID` and `PLAID_SANDBOX_SECRET`; the nightly workflow also requires `NEON_API_KEY`. It creates and removes its own Sandbox Item and fixture budget. It does not complete Link re-consent; changed-ID behavior is covered by deterministic service tests, and real re-consent remains a separate manual check.
