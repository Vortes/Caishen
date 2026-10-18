import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptBankToken,
  decryptBankToken,
} from "../../src/server/token-crypto";

void test("bank tokens are authenticated, randomized and bound to their owner", () => {
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a1".repeat(32);
  const one = encryptBankToken("secret-access-token", "alice");
  const two = encryptBankToken("secret-access-token", "alice");
  assert.notEqual(one, two);
  assert.ok(!one.includes("secret-access-token"));
  assert.equal(decryptBankToken(one, "alice"), "secret-access-token");
  assert.throws(() => decryptBankToken(one, "bob"));
  const parts = one.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptBankToken(parts.join("."), "alice"));
  delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
  assert.throws(() => encryptBankToken("x", "alice"));
});
