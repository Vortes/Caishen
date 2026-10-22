import { createTRPCClient } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { expect, test } from "vitest";
import {
  clientBuild,
  serverOperation,
  trpcTransport,
} from "~/components/sync/trpc-transport";
import { SyncError } from "~/components/sync/transport";
import type { AppRouter } from "~/server/api/root";
import { appLinks, serverRevisions } from "~/trpc/links";
import { componentFetch, type Handlers } from "../component-server";
import { FakeServer, household } from "./fake-server";

function connect(handlers: Handlers = {}, fetch?: typeof globalThis.fetch) {
  const server = new FakeServer(household());
  const client = createTRPCClient<AppRouter>({
    links: appLinks({
      url: "http://component.invalid/api/trpc",
      fetch: fetch ?? componentFetch(server, "alex", handlers),
    }),
  });
  const revisions: (number | undefined)[] = [];
  const stop = serverRevisions.subscribe((hint) =>
    revisions.push(hint.revision),
  );
  return { server, client, transport: trpcTransport(client), revisions, stop };
}

const food = (id: string, amount: number) => ({
  type: "assign" as const,
  id,
  categoryId: "food",
  month: "2026-10",
  amount,
});

test("the browser's build names the format the server checks", () => {
  expect(clientBuild).toMatch(/^1:./);
});

test("executes and pulls over the sync contract, and every answer reports the household revision", async () => {
  const { server, client, transport, revisions, stop } = connect();
  const pulled = await transport.pull({ since: null, clientBuild });
  expect(pulled).toMatchObject({ revision: 0, reset: false });
  expect(pulled.rows.length).toBeGreaterThan(0);

  const executed = await transport.execute({
    command: food("a1", 1_000),
    baseRevision: 0,
    clientId: "tab",
  });
  expect(executed).toMatchObject({ revision: 1, rebased: false });
  expect(executed.changeSet?.operationId).toBe("a1");
  expect(server.revision).toBe(1);

  // The partner saves; a later answer of any kind tells this browser,
  // refusals included. A pull's own answer says nothing more: the pull
  // brings what it reports, and one that failed is retried on its own
  // schedule, not again at once.
  server.act("jordan", food("j1", 500));
  await client.budget.invite.mutate().catch(() => undefined);
  await transport.pull({ since: 2, clientBuild });
  expect(revisions).toEqual([1, 2]);
  stop();
});

test("server refusals arrive with their kind and the revision they were decided at", async () => {
  const { server, transport, stop } = connect();
  const refused = await transport
    .execute({
      command: { ...food("a1", 100), categoryId: "missing" },
      baseRevision: 0,
      clientId: "tab",
    })
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(SyncError);
  expect(refused).toMatchObject({ kind: "rejected", revision: 0 });

  server.requiredBuild = "2:next";
  const stale = await transport
    .pull({ since: 0, clientBuild })
    .catch((error: unknown) => error);
  expect(stale).toBeInstanceOf(SyncError);
  expect(stale).toMatchObject({
    kind: "staleClient",
    message: "Reload to get the latest version",
  });
  stop();
});

test("any other failure is an unknown outcome, so the command is retried", async () => {
  const failing = connect({
    "budget.execute": () => {
      throw new Error("Database unavailable");
    },
  });
  const crashed = await failing.transport
    .execute({ command: food("a1", 100), baseRevision: 0, clientId: "tab" })
    .catch((error: unknown) => error);
  expect(crashed).toBeInstanceOf(Error);
  expect(crashed).not.toBeInstanceOf(SyncError);
  failing.stop();

  const offline = connect({}, () =>
    Promise.reject(new TypeError("Failed to fetch")),
  );
  const lost = await offline.transport
    .pull({ since: null, clientBuild })
    .catch((error: unknown) => error);
  expect(lost).toBeInstanceOf(Error);
  expect(lost).not.toBeInstanceOf(SyncError);
  offline.stop();
});

test("a server-only operation the server turned down is refused, not retried", async () => {
  const errors: Record<string, () => never> = {
    notFound: () => {
      throw new TRPCError({ code: "NOT_FOUND", message: "Import not found." });
    },
    precondition: () => {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Update your bank first.",
      });
    },
    unauthorized: () => {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    },
    crashed: () => {
      throw new Error("Database unavailable");
    },
  };
  const outcomes: Record<string, unknown> = {};
  for (const [name, fail] of Object.entries(errors)) {
    const { client, stop } = connect({ "budget.resolveImport": fail });
    outcomes[name] = await serverOperation(() =>
      client.budget.resolveImport.mutate({
        connectionId: "bank",
        logicalId: "import",
        expectedRevision: 0,
      }),
    ).catch((error: unknown) =>
      error instanceof SyncError ? error.kind : "unknown",
    );
    stop();
  }
  expect(outcomes).toEqual({
    notFound: "rejected",
    precondition: "rejected",
    // Signing in again or a server that recovers can still save it.
    unauthorized: "unknown",
    crashed: "unknown",
  });
});
