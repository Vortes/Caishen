import test from "node:test";
import assert from "node:assert/strict";
import {
  commandHash,
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
