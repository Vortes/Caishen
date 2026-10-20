import test from "node:test";
import assert from "node:assert/strict";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Prisma } from "../../src/generated/prisma";
import { formatTRPCError } from "../../src/server/api/error-formatter";
import {
  commandHash,
  domainError,
  requireCronAuthorization,
} from "../../src/server/services/safety";

void test("scheduler rejects absent configuration and invalid credentials", () => {
  delete process.env.CRON_SECRET;
  assert.throws(() => requireCronAuthorization(null));
  process.env.CRON_SECRET = "s".repeat(40);
  assert.throws(() => requireCronAuthorization(null));
  assert.throws(() => requireCronAuthorization("Bearer wrong"));
  assert.doesNotThrow(() =>
    requireCronAuthorization("Bearer " + "s".repeat(40)),
  );
  delete process.env.CRON_SECRET;
});
void test("audit command hashes distinguish changed payloads", () => {
  assert.equal(
    commandHash({ id: "same", amount: 1 }),
    commandHash({ id: "same", amount: 1 }),
  );
  assert.notEqual(
    commandHash({ id: "same", amount: 1 }),
    commandHash({ id: "same", amount: 2 }),
  );
});

void test("database failures never expose Prisma invocations or budget data", () => {
  const message =
    'Invalid prisma.workspace.updateMany() invocation: book: { payee: "Private purchase", amount: 12345 }';
  const clientVersion = Prisma.prismaVersion.client;
  const errors = [
    new Prisma.PrismaClientValidationError(message, { clientVersion }),
    new Prisma.PrismaClientUnknownRequestError(message, { clientVersion }),
    new Prisma.PrismaClientInitializationError(message, clientVersion),
    new Prisma.PrismaClientRustPanicError(message, clientVersion),
    new Prisma.PrismaClientKnownRequestError(message, {
      clientVersion,
      code: "P2025",
    }),
  ];
  for (const error of errors)
    assert.throws(() => domainError(error), {
      name: "TRPCError",
      code: "INTERNAL_SERVER_ERROR",
      message: "The budget could not be saved. Try again.",
    });
});

void test("database failures from another loaded Prisma runtime are sanitized", () => {
  for (const name of [
    "PrismaClientValidationError",
    "PrismaClientUnknownRequestError",
    "PrismaClientInitializationError",
    "PrismaClientRustPanicError",
    "PrismaClientKnownRequestError",
  ]) {
    const error = Object.assign(new Error("Private budget invocation"), {
      name,
      clientVersion: Prisma.prismaVersion.client,
    });
    assert.throws(() => domainError(error), {
      code: "INTERNAL_SERVER_ERROR",
      message: "The budget could not be saved. Try again.",
    });
  }
});

void test("database concurrency errors still request a refresh", () => {
  for (const code of ["P2034", "P2002"]) {
    const errors = [
      new Prisma.PrismaClientKnownRequestError("Private invocation", {
        clientVersion: Prisma.prismaVersion.client,
        code,
      }),
      Object.assign(new Error("Private invocation"), {
        name: "PrismaClientKnownRequestError",
        clientVersion: Prisma.prismaVersion.client,
        code,
      }),
    ];
    for (const error of errors)
      assert.throws(() => domainError(error), {
        code: "CONFLICT",
        message: "Your budget changed. Refresh and try again.",
      });
  }
});

void test("domain validation and explicit API errors remain readable", () => {
  assert.throws(() => domainError(new Error("Choose an existing category.")), {
    code: "BAD_REQUEST",
    message: "Choose an existing category.",
  });
  const explicit = new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Create your budget first.",
  });
  assert.throws(
    () => domainError(explicit),
    (error) => error === explicit,
  );
  const unrelated = new Error("Choose an existing account.");
  unrelated.name = "PrismaClientValidationError";
  assert.throws(() => domainError(unrelated), {
    code: "BAD_REQUEST",
    message: "Choose an existing account.",
  });
});

async function errorResponse(error: Error) {
  const t = initTRPC.create({ isDev: true, errorFormatter: formatTRPCError });
  const router = t.router({
    fail: t.procedure.query(() => {
      throw error;
    }),
  });
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: new Request("http://localhost/api/trpc/fail"),
    router,
    createContext: () => ({}),
  });
}

void test("API errors hide uncaught database payloads and development stacks", async () => {
  const error = new Prisma.PrismaClientValidationError(
    'Invalid prisma.workspace.updateMany() invocation: { payee: "Private purchase", amount: 12345 }',
    { clientVersion: Prisma.prismaVersion.client },
  );
  const response = await errorResponse(error);
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.match(body, /The budget could not be saved/);
  assert.doesNotMatch(body, /Private purchase|12345|prisma\.workspace|"stack"/);
});

void test("API error formatting preserves authorization and domain messages", async () => {
  for (const error of [
    new TRPCError({ code: "UNAUTHORIZED", message: "Sign in first." }),
    new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose an existing category.",
    }),
  ]) {
    const response = await errorResponse(error);
    const body = await response.text();
    assert.equal(response.status, error.code === "UNAUTHORIZED" ? 401 : 400);
    assert.ok(body.includes(error.message));
  }
});
