import assert from "node:assert/strict";
import test from "node:test";
import { readAmount } from "../../src/components/budget/amount";
import { money } from "../../src/components/budget/format";

const amountMessage = "Enter an amount, such as 84.20 or 600+150.";

function accepts(rows: readonly (readonly [string, number])[]) {
  for (const [input, cents] of rows)
    assert.deepEqual(readAmount(input), { ok: true, cents }, input);
}

void test("amounts accept whole dollars, cents, separators and sums", () => {
  accepts([
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
  ]);
});

function rejects(inputs: readonly string[], message: string) {
  for (const input of inputs)
    assert.deepEqual(readAmount(input), { ok: false, message }, input);
}

void test("text that isn't an amount gets the one amount message", () => {
  rejects(
    [
      "",
      "600+",
      "+",
      "1e3",
      "100abc",
      "NaN",
      "Infinity",
      "(600+1000",
      "600+1000)",
      "()",
      "2**3",
      "1.",
      "$",
    ],
    amountMessage,
  );
});

void test("amounts multiply and divide before they add, with either sign", () => {
  accepts([
    ["100*2", 20_000],
    ["100/2", 5_000],
    ["100×2", 20_000],
    ["100÷2", 5_000],
    ["1200/12", 10_000],
    ["45.20+12.99", 5_819],
    ["600+150*2", 90_000],
    ["600-100/4", 57_500],
    ["1,200*12", 1_440_000],
    ["100/4/5", 500],
  ]);
});

void test("parentheses group a calculation", () => {
  accepts([
    ["(600+1000)", 160_000],
    ["(600+150)*2", 150_000],
    ["(600+150)×2", 150_000],
    ["2*(3+(4-1))", 1_200],
    ["$(1,200 + 300) / 3", 50_000],
  ]);
});

void test("a minus sign negates the number or group after it", () => {
  accepts([
    ["600--10", 61_000],
    ["600+-10", 59_000],
    ["-(100+50)", -15_000],
    ["2*-3", -600],
    ["600−100", 50_000],
    ["−25.50", -2_550],
  ]);
});

void test("powers come before products and group from the right", () => {
  accepts([
    ["10^2", 10_000],
    ["2^3^2", 51_200],
    ["3*2^2", 1_200],
    ["-2^2", -400],
    ["2^-1", 50],
    ["(-2)^3", -800],
    ["1.1^2", 121],
    ["(1+1)^(1+1)", 400],
  ]);
});

void test("the result rounds to the nearest cent, half a cent away from zero", () => {
  accepts([
    ["100/3", 3_333],
    ["200/3", 6_667],
    ["84.20/3", 2_807],
    ["0.005", 1],
    ["-0.005", -1],
    ["0.0049", 0],
    ["-0.0049", 0],
    ["1.234", 123],
    ["1.00+0.001", 100],
    ["0.001*10", 1],
  ]);
});

void test("dividing by zero is refused", () => {
  rejects(
    ["100/0", "100÷0", "0/0", "100/(5-5)", "0^-1"],
    "Divide by a number other than zero.",
  );
});

void test("a power must be a whole number", () => {
  rejects(["4^0.5", "4^(1/2)", "2^-0.5"], "Use a whole number after ^.");
  accepts([
    ["4^(4/2)", 1_600],
    ["4^2.0", 1_600],
  ]);
});

void test("a result beyond a safe number of cents is too large", () => {
  accepts([
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["90071992547409.90+0.01", Number.MAX_SAFE_INTEGER],
    ["90071992547409.91+0.01-0.01", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", -Number.MAX_SAFE_INTEGER],
    ["10^20/10^19", 1_000],
  ]);
  rejects(
    [
      "90071992547409.92",
      "90071992547409.915",
      "90071992547409.91+0.01",
      "-90071992547409.91-0.01",
      "999999999999999999999999999",
      "10^1000000000",
      "9^9^9",
    ],
    "That amount is too large.",
  );
});

void test("other money fields continue to accept literal amounts only", () => {
  const data = new FormData();
  data.set("amount", "1,000.00");
  assert.equal(money(data, "amount"), 100_000);
  data.set("amount", "600.00+1000");
  assert.throws(() => money(data, "amount"), /dollar amount/);
});
