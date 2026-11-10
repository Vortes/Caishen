import assert from "node:assert/strict";
import test from "node:test";

import {
  itemHealthChange,
  webhookChange,
} from "../../src/server/services/bank-connection-status";
import type { PlaidWebhook } from "../../src/server/plaid-webhook";

// A revoked or disconnected bank leaves that state only through a new link
// or reconnect, never through a webhook or account update that arrives late.

const now = new Date("2026-10-25T12:00:00Z");
const item = (webhook_code: string, extra: Partial<PlaidWebhook> = {}) =>
  ({
    webhook_type: "ITEM",
    webhook_code,
    item_id: "item-fixture",
    ...extra,
  }) as PlaidWebhook;

for (const current of ["revoked", "disconnected"] as const)
  for (const webhook of [
    item("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } }),
    item("PENDING_DISCONNECT"),
    item("PENDING_EXPIRATION", {
      consent_expiration_time: "2026-11-01T00:00:00Z",
    }),
    item("LOGIN_REPAIRED"),
    item("USER_PERMISSION_REVOKED"),
  ])
    void test(`a late ${webhook.webhook_code} webhook leaves a ${current} bank ${current}`, () => {
      assert.equal(
        webhookChange(webhook, current, now)?.change.status,
        undefined,
      );
    });

void test("a sign-in problem still marks a connected bank", () => {
  assert.equal(
    webhookChange(
      item("ERROR", { error: { error_code: "ITEM_LOGIN_REQUIRED" } }),
      "connected",
      now,
    )?.change.status,
    "login_required",
  );
});

for (const current of ["revoked", "disconnected"] as const)
  void test(`an account update reporting a sign-in problem leaves a ${current} bank ${current}`, () => {
    const change = itemHealthChange(
      {
        errorCode: "ITEM_LOGIN_REQUIRED",
        consentExpiresAt: null,
        lastSuccessfulUpdateAt: null,
        lastFailedUpdateAt: now,
      },
      current,
    );
    assert.equal(change.status, current);
  });
