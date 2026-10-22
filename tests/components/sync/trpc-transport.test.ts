import { createTRPCClient } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
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
    busy: () => {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
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
    unauthorized: "signedOut",
    // A server that recovers can still save it.
    crashed: "unknown",
    busy: "unknown",
  });
});

const invalidInput = () =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: JSON.stringify([{ path: ["command", "amount"] }]),
    cause: new ZodError([
      {
        code: "invalid_type",
        expected: "number",
        received: "string",
        path: ["command", "amount"],
        message: "Expected number, received string",
      },
    ]),
  });

test("a request the server can never accept is refused, and a lost sign-in stops syncing, for commands and pulls alike", async () => {
  const errors: Record<string, () => never> = {
    invalid: () => {
      throw invalidInput();
    },
    unreadable: () => {
      throw new TRPCError({ code: "PARSE_ERROR" });
    },
    signedOut: () => {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    },
    inactive: () => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This Caishen account is inactive.",
      });
    },
    crashed: () => {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    },
    maintenance: () => {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
    },
    timedOut: () => {
      throw new TRPCError({ code: "TIMEOUT" });
    },
    busy: () => {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
    },
  };
  const outcome = (error: unknown) =>
    error instanceof SyncError ? `${error.kind}: ${error.message}` : "unknown";
  for (const call of ["execute", "pull"] as const) {
    const outcomes: Record<string, string> = {};
    for (const [name, fail] of Object.entries(errors)) {
      const { transport, stop } = connect({
        [call === "execute" ? "budget.execute" : "sync.pull"]: fail,
      });
      outcomes[name] = await (
        call === "execute"
          ? transport.execute({
              command: food("a1", 100),
              baseRevision: 0,
              clientId: "tab",
            })
          : transport.pull({ since: null, clientBuild })
      ).then(() => "answered", outcome);
      stop();
    }
    expect(outcomes, call).toEqual({
      invalid:
        "rejected: Caishen couldn’t read this change, so it wasn’t saved.",
      unreadable:
        "rejected: Caishen couldn’t read this change, so it wasn’t saved.",
      signedOut: "signedOut: Sign in to keep saving your changes.",
      inactive: "signedOut: This Caishen account is inactive.",
      crashed: "unknown",
      maintenance: "unknown",
      timedOut: "unknown",
      busy: "unknown",
    });
  }
});

test("someone without a budget is told so, not left retrying", async () => {
  const { server, transport, stop } = connect();
  server.withoutBudget.add("alex");
  const refused = await transport
    .pull({ since: null, clientBuild })
    .catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(SyncError);
  expect(refused).toMatchObject({ kind: "noBudget" });
  stop();
});

test("sync calls go alone so each answer carries the revision; other calls are batched and still report it", async () => {
  const server = new FakeServer(household());
  const requests: string[] = [];
  const served = componentFetch(server, "alex", {
    "budget.invite": () => ({ code: "invite" }),
    "budget.sync": () => ({ synced: true }),
  });
  const client = createTRPCClient<AppRouter>({
    links: appLinks({
      url: "http://component.invalid/api/trpc",
      fetch: (address, init) => {
        const url = new URL(
          address instanceof Request ? address.url : address.toString(),
        );
        requests.push(
          `${url.pathname.replace("/api/trpc/", "")}${url.searchParams.has("batch") ? " (batch)" : ""}`,
        );
        return served(address, init);
      },
    }),
  });
  const revisions: (number | undefined)[] = [];
  const stop = serverRevisions.subscribe((hint) =>
    revisions.push(hint.revision),
  );
  const transport = trpcTransport(client);

  await Promise.all([
    transport.execute({
      command: food("a1", 100),
      baseRevision: 0,
      clientId: "tab",
    }),
    transport.pull({ since: null, clientBuild }),
  ]);
  expect(requests.sort()).toEqual(["budget.execute", "sync.pull"]);
  expect(revisions).toEqual([1]);

  requests.length = 0;
  server.act("jordan", food("j1", 500));
  await Promise.all([
    client.budget.invite.mutate(),
    client.budget.sync.mutate(),
  ]);
  expect(requests).toEqual(["budget.invite,budget.sync (batch)"]);
  expect(revisions).toEqual([1, 2, 2]);
  stop();
});
