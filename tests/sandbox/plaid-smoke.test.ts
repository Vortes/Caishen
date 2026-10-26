import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import nextEnv from "@next/env";
import { z } from "zod";

import { isCounterparty } from "../../src/domain/engine";
import { PrismaClient } from "../../src/generated/prisma";
import { ObservedRevision } from "../../src/server/api/trpc";
import { assertDevelopmentDatabase } from "../../src/server/dev/development-database";
import { createPlaidClient } from "../../src/server/integrations/plaid";
import {
  bankMappingsSchema,
  bankSetupDate,
} from "../../src/server/services/bank-account-setup";
import { plaidRequestRecorder } from "../../src/server/services/bank-provider-events";
import { encryptBankToken } from "../../src/server/token-crypto";
import { createDatabaseCaller } from "../database/fixtures";

nextEnv.loadEnvConfig(process.cwd(), true);

// This smoke test uses real Sandbox responses. It does not complete Link
// consent or force changed account IDs; deterministic service tests cover
// those responses, and real re-consent remains a separate manual check.
void test(
  "Chase Sandbox refresh preserves explicitly added depository accounts",
  { timeout: 240_000 },
  async (t) => {
    const required = [
      "PLAID_SANDBOX_CLIENT_ID",
      "PLAID_SANDBOX_SECRET",
    ] as const;
    const missing = required.filter((name) => !process.env[name]);
    assert.equal(
      missing.length,
      0,
      `Configure repository secrets: ${missing.join(", ")}`,
    );
    assertDevelopmentDatabase(process.env);
    process.env.PLAID_CLIENT_ID = process.env.PLAID_SANDBOX_CLIENT_ID!;
    process.env.PLAID_SECRET = process.env.PLAID_SANDBOX_SECRET!;
    process.env.PLAID_ENV = "sandbox";
    process.env.BANK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
    delete process.env.PLAID_REDIRECT_URI;
    delete process.env.APP_BASE_URL;

    const db = new PrismaClient();
    const userId = `sandbox-smoke-${randomUUID()}`;
    const requestIds = new Set<string>();
    const record = plaidRequestRecorder(db, { userId });
    const plaid = createPlaidClient(
      {
        clientId: process.env.PLAID_CLIENT_ID,
        secret: process.env.PLAID_SECRET,
        environment: "sandbox",
      },
      fetch,
      async (event) => {
        if (event.requestId) requestIds.add(event.requestId);
        await record(event);
      },
    );
    const item: { accessToken?: string } = {};
    t.after(async () => {
      try {
        if (item.accessToken) await plaid.removeItem(item.accessToken);
      } finally {
        try {
          const events = await db.bankProviderEvent.findMany({
            where: { clerkUserId: userId },
            select: { requestId: true },
          });
          for (const event of events)
            if (event.requestId) requestIds.add(event.requestId);
          t.diagnostic(
            `Plaid request IDs: ${[...requestIds].join(", ") || "none returned"}`,
          );
          await db.bankProviderEvent.deleteMany({
            where: { clerkUserId: userId },
          });
          await db.bankConnection.deleteMany({
            where: { clerkUserId: userId },
          });
          await db.workspace.deleteMany({
            where: { members: { some: { clerkUserId: userId } } },
          });
          await db.user.deleteMany({ where: { clerkUserId: userId } });
        } finally {
          await db.$disconnect();
        }
      }
    });
    await db.user.create({ data: { clerkUserId: userId } });
    const api = createDatabaseCaller({
      db,
      userId,
      headers: new Headers(),
      revision: new ObservedRevision(),
    });
    const month = bankSetupDate("America/Los_Angeles").slice(0, 7);
    await api.budget.onboard({
      name: "Sandbox smoke",
      month,
      timezone: "America/Los_Angeles",
    });

    const response = await fetch(
      "https://sandbox.plaid.com/sandbox/public_token/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: process.env.PLAID_CLIENT_ID,
          secret: process.env.PLAID_SECRET,
          institution_id: "ins_56",
          initial_products: ["transactions"],
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const result: unknown = await response.json();
    const receipt = z
      .object({
        request_id: z.string().optional(),
        error_code: z.string().optional(),
      })
      .parse(result);
    if (receipt.request_id) requestIds.add(receipt.request_id);
    assert.ok(
      response.ok,
      `Sandbox Item creation failed: ${receipt.error_code ?? response.status}; request ${receipt.request_id ?? "unknown"}`,
    );
    const { public_token: publicToken } = z
      .object({ public_token: z.string() })
      .parse(result);
    const exchanged = await plaid.exchangePublicToken(publicToken);
    const accessToken = exchanged.accessToken;
    item.accessToken = accessToken;
    const reported = await plaid.getAccounts(accessToken);
    const selected = reported.accounts.filter(
      (account) => account.type === "depository" && account.currency === "USD",
    );
    assert.ok(
      selected.length > 0,
      "Chase Sandbox returned no USD depository accounts",
    );

    // Sandbox's token endpoint bypasses Link and returns no Link metadata.
    // Seed the connection with the actual exchanged Item, then use the same
    // public procedures the app uses for refresh and explicit account setup.
    const connection = await db.bankConnection.create({
      data: {
        clerkUserId: userId,
        itemId: exchanged.itemId,
        encryptedToken: encryptBankToken(accessToken, userId),
        imports: {},
        accountMappings: {},
      },
    });
    await api.budget.plaidReconnect({ connectionId: connection.id });
    const state = () => api.budget.state({ month });
    let current = await state();
    const deadline = Date.now() + 120_000;
    while (true) {
      await api.budget.sync();
      current = await state();
      const bank = current.connections.find(
        (item) => item.id === connection.id,
      )!;
      assert.equal(
        bank.error,
        null,
        "Sandbox account update failed; see request IDs below",
      );
      if (
        selected.every((account) =>
          bank.synchronizedAccountIds.includes(account.accountId),
        )
      )
        break;
      assert.ok(
        Date.now() < deadline,
        "Sandbox account history was not ready within two minutes",
      );
      await setTimeout(2_000);
    }
    const bank = current.connections.find((item) => item.id === connection.id)!;
    await api.budget.setupBankAccounts({
      connectionId: connection.id,
      operationId: randomUUID(),
      expectedRevision: current.revision,
      accounts: selected.map((account) => ({
        providerAccountId: account.accountId,
        name: account.name,
        expectedBalance: bank.accounts.find(
          (item) => item.accountId === account.accountId,
        )!.currentBalance,
      })),
    });
    const before = await state();
    const accounts = before.view!.budget.accounts.filter(
      (account) => !isCounterparty(account),
    );
    assert.equal(accounts.length, selected.length);
    await api.budget.plaidReconnect({ connectionId: connection.id });
    await api.budget.sync();
    const after = await state();
    assert.deepEqual(
      after.view!.budget.accounts.filter((account) => !isCounterparty(account)),
      accounts,
    );
    const refreshed = after.connections.find(
      (item) => item.id === connection.id,
    )!;
    assert.equal(refreshed.error, null);
    const mappings = bankMappingsSchema.parse(refreshed.accountMappings);
    assert.equal(Object.keys(mappings).length, selected.length);
    for (const providerId of Object.keys(mappings)) {
      assert.ok(
        refreshed.accounts.some((account) => account.accountId === providerId),
        "A linked budget account has no provider identity",
      );
    }
  },
);
