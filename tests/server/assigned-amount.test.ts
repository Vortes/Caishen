import assert from "node:assert/strict";
import test from "node:test";
import { parseAssignedAmount } from "../../src/components/budget/assigned-amount";
import { money } from "../../src/components/budget/format";

void test("assigned amounts accept whole dollars and exact addition/subtraction", () => {
  for (const [input, expected] of [
    ["1000", 100_000],
    ["600.00+1000", 160_000],
    ["1600-25.50", 157_450],
    ["0.10+0.20-0.05", 25],
    ["600+1000-250+0.99", 135_099],
    ["$1,600.00 - $25.50", 157_450],
    ["-10+2.50", -750],
    ["+1000", 100_000],
    ["100-200", -10_000],
    ["100-100", 0],
  ] as const)
    assert.equal(parseAssignedAmount(input), expected, input);
});

void test("assigned calculations reject incomplete or unsupported syntax and excess precision", () => {
  for (const input of [
    "",
    "600+",
    "600--10",
    "600+-10",
    "+",
    "1.234",
    "1.00+0.001",
    "100*2",
    "100/2",
    "(600+1000)",
    "1e3",
    "100abc",
    "NaN",
    "Infinity",
  ])
    assert.throws(
      () => parseAssignedAmount(input),
      /Enter an amount or add\/subtract amounts/,
      input,
    );
});

void test("assigned calculations reject unsafe operands and intermediate totals", () => {
  assert.equal(
    parseAssignedAmount("90071992547409.91"),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(
    parseAssignedAmount("90071992547409.90+0.01"),
    Number.MAX_SAFE_INTEGER,
  );
  for (const input of [
    "90071992547409.92",
    "90071992547409.91+0.01",
    "-90071992547409.91-0.01",
    "90071992547409.91+0.01-0.01",
    "999999999999999999999999999",
  ])
    assert.throws(() => parseAssignedAmount(input), /too large/, input);
});

void test("other money fields continue to accept literal amounts only", () => {
  const data = new FormData();
  data.set("amount", "1,000.00");
  assert.equal(money(data, "amount"), 100_000);
  data.set("amount", "600.00+1000");
  assert.throws(() => money(data, "amount"), /dollar amount/);
});
