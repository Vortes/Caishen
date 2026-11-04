import assert from "node:assert/strict";
import test from "node:test";
import { toShellData } from "../../src/components/app-shell/model";
import { underfunded } from "../../src/domain/auto-assign";
import { execute, projectBook, type Command } from "../../src/domain/engine";
import { buildDevelopmentSeed } from "../../src/server/dev/seed-scenarios";

const month = "2026-10";
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;

// The simple preset (#265): Alex owes Jordan $1,488.58 for five purchases.
// Parking is $20.00 short of Alex's part of Platinum Parking, and Trader
// Joe's has no category, so $53.42 is still to fund.
function simple() {
  let book = buildDevelopmentSeed({
    userId: "alex",
    partnerId: "jordan",
    asOf: `${month}-20`,
    scenario: "simple",
  }).book;
  let sequence = 0;
  return {
    run(command: WithoutId<Command>) {
      book = execute(book, "alex", { ...command, id: `test-${++sequence}` });
    },
    shell(viewMonth = month) {
      return toShellData(
        {
          view: projectBook(book, "alex", viewMonth, month),
          connections: [],
          imports: [],
          partnerFirstName: "Jordan",
        },
        month,
      );
    },
  };
}

const jordan = (shell: ReturnType<ReturnType<typeof simple>["shell"]>) =>
  shell.categories.find((category) => category.name === "Jordan")!;

void test("the partner's row is underfunded by what's still to fund, filling toward what you owe", () => {
  const row = jordan(simple().shell());

  assert.deepEqual(
    {
      funding: row.funding,
      status: row.status,
      fundedRatio: row.fundedRatio,
      owed: row.partnerFunding?.owed,
      stillToFund: row.partnerFunding?.stillToFund,
    },
    {
      funding: "underfunded",
      status: "$53.42 more needed",
      // $1,435.16 of the $1,488.58 owed is set aside.
      fundedRatio: 143_516 / 148_858,
      owed: 148_858,
      stillToFund: 5_342,
    },
  );
});

void test("the partner's row turns green once everything you owe is set aside", () => {
  const home = simple();
  home.run({
    type: "assign",
    categoryId: jordan(home.shell()).id,
    month,
    amount: 5_342,
  });
  const row = jordan(home.shell());

  assert.deepEqual(
    {
      funding: row.funding,
      status: row.status,
      fundedRatio: row.fundedRatio,
      stillToFund: row.partnerFunding?.stillToFund,
    },
    { funding: "funded", status: "", fundedRatio: 1, stillToFund: 0 },
  );
});

void test("each of the partner's purchases shows your part, its category and whether it's set aside", () => {
  const row = jordan(simple().shell());

  assert.deepEqual(
    row.partnerFunding?.purchases.map(
      ({ payee, date, amount, category, state, short }) => ({
        payee,
        date,
        amount,
        category,
        state,
        short,
      }),
    ),
    [
      {
        payee: "H Mart",
        date: "2026-10-01",
        amount: 1_338,
        category: "Groceries",
        state: "set-aside",
        short: 0,
      },
      {
        payee: "BILT · rent",
        date: "2026-10-01",
        amount: 136_195,
        category: "Rent",
        state: "set-aside",
        short: 0,
      },
      {
        payee: "Shake Shack",
        date: "2026-10-01",
        amount: 883,
        category: "Dining out",
        state: "set-aside",
        short: 0,
      },
      {
        payee: "Platinum Parking",
        date: "2026-10-02",
        amount: 7_100,
        category: "Parking",
        state: "short",
        short: 2_000,
      },
      {
        payee: "Trader Joe’s",
        date: "2026-10-03",
        amount: 3_342,
        category: undefined,
        state: "needs-category",
        short: 3_342,
      },
    ],
  );
});

void test("earlier short purchases leave the list once nothing is still to fund", () => {
  const home = simple();
  const listed = () =>
    jordan(home.shell("2026-11")).partnerFunding?.purchases.map(
      ({ payee }) => payee,
    );
  assert.deepEqual(listed(), ["Platinum Parking", "Trader Joe’s"]);

  home.run({
    type: "assign",
    categoryId: jordan(home.shell()).id,
    month: "2026-11",
    amount: 5_342,
  });

  assert.deepEqual(listed(), []);
});

void test("a red partner's row shows its overspending, and Underfunded also covers what's still to fund", () => {
  const home = simple();
  // Alex pays Jordan $1,460.00 of the $1,488.58 owed, $24.84 more than the
  // $1,435.16 set aside, so $28.58 is still to fund.
  home.run({
    type: "partner.settle",
    settlementId: "test-settlement",
    method: "Bank transfer",
    legs: [
      {
        userId: "alex",
        accountId: "checking",
        date: `${month}-15`,
        amount: -146_000,
        payee: "Jordan",
      },
      {
        userId: "jordan",
        accountId: "checking",
        date: `${month}-15`,
        amount: 146_000,
        payee: "Alex",
      },
    ],
  });
  const row = jordan(home.shell());

  assert.deepEqual(
    {
      available: row.available,
      funding: row.funding,
      stillToFund: row.partnerFunding?.stillToFund,
      underfunded: underfunded(row.autoAssign),
    },
    {
      available: -2_484,
      funding: "overspent",
      stillToFund: 2_858,
      underfunded: 5_342,
    },
  );
});

void test("the partner's details caption says what's still needed to pay them, or that it's all set aside", () => {
  const home = simple();
  const caption = () => jordan(home.shell()).partnerFunding?.caption;
  assert.equal(caption(), "$53.42 more needed to pay Jordan");

  home.run({
    type: "assign",
    categoryId: jordan(home.shell()).id,
    month,
    amount: 5_342,
  });
  assert.equal(caption(), "Everything you owe Jordan is set aside");
});
