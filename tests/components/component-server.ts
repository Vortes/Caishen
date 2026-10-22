import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { z } from "zod";
import { SyncError } from "~/components/sync/transport";
import { formatTRPCError } from "~/server/api/error-formatter";
import {
  ObservedRevision,
  revisionResponseMeta,
} from "~/server/api/revision-header";
import { refusal } from "~/server/services/sync-refusal";
import type { FakeServer } from "./sync/fake-server";

// The app's tRPC endpoint for component tests: the real error formatting and
// revision header, with procedures answered by the fake server (the real
// engine over rows) and by handlers a test chooses. No database is used.

export type Handlers = Partial<
  Record<string, (input: unknown, server: FakeServer) => unknown>
>;

const t = initTRPC
  .context<{ revision: ObservedRevision }>()
  .create({ transformer: superjson, errorFormatter: formatTRPCError });

// The fake server's refusals, as the real server sends them.
async function served(answer: () => unknown): Promise<unknown> {
  try {
    return await answer();
  } catch (error) {
    if (error instanceof SyncError)
      throw refusal(error.kind, error.message, error.revision);
    throw error;
  }
}

/**
 * A fetch that serves `viewerId`'s requests. `handlers` answer any path by
 * name ("budget.overview"); budget.execute and sync.pull default to the
 * fake server.
 */
export function componentFetch(
  server: FakeServer,
  viewerId: string,
  handlers: Handlers = {},
): typeof fetch {
  const procedure = () =>
    t.procedure.input(z.unknown()).use(async ({ ctx, next }) => {
      const result = await next();
      ctx.revision.observe(server.revision);
      return result;
    });
  const answer =
    (path: string, fallback?: (input: never) => unknown) =>
    async ({ input }: { input: unknown }) => {
      const handler = handlers[path];
      if (handler) return served(() => handler(input, server));
      if (fallback) return served(() => fallback(input as never));
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Unexpected component request: ${path}`,
      });
    };
  const query = (path: string, fallback?: (input: never) => unknown) =>
    procedure().query(answer(path, fallback));
  const mutation = (path: string, fallback?: (input: never) => unknown) =>
    procedure().mutation(answer(path, fallback));
  const router = t.router({
    budget: t.router({
      execute: mutation("budget.execute", (input) =>
        server.execute(viewerId, input),
      ),
      overview: query("budget.overview", () => ({
        status: "ready",
        services: [],
        connections: [],
        imports: [],
      })),
      resolveImport: mutation("budget.resolveImport"),
      setupBankAccounts: mutation("budget.setupBankAccounts"),
      sync: mutation("budget.sync"),
      invite: mutation("budget.invite"),
    }),
    sync: t.router({
      pull: query("sync.pull", (input) => server.pull(viewerId, input)),
    }),
  });
  return async (address, init) =>
    fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(address, init),
      router,
      createContext: () => ({ revision: new ObservedRevision() }),
      responseMeta: revisionResponseMeta,
    });
}
