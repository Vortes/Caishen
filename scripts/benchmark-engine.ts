// Times the accounting engine on synthetic heavy households: 150 transactions
// per partner per month, 2 partners, 30 assignments per month.
// Usage: node --import tsx scripts/benchmark-engine.ts [years...]
import {
  execute,
  projectBook,
  type Book,
  type Command,
} from "../src/domain/engine";
import {
  monthAfter,
  syntheticBook,
} from "../tests/domain/fixtures/synthetic-book";

const startMonth = "2020-01";
const years = process.argv.slice(2).map(Number);

function time(run: () => unknown) {
  const samples: number[] = [];
  for (let index = 0; index < 11; index++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return samples.sort((a, b) => a - b)[5]!;
}

function scenario(book: Book, months: number) {
  const current = monthAfter(startMonth, months - 1);
  const run = (command: Command) => () => execute(book, "alex", command);
  const card = projectBook(book, "alex", current)
    .accounts.filter((account) => account.kind === "credit")
    .sort((a, b) => b.reserve - a.reserve)[0]!;
  return {
    "execute assign (2nd month)": run({
      type: "assign",
      id: "benchmark-assign",
      categoryId: "groceries",
      month: monthAfter(startMonth, 1),
      amount: 100,
    }),
    "execute assign (current month)": run({
      type: "assign",
      id: "benchmark-assign",
      categoryId: "groceries",
      month: current,
      amount: 100,
    }),
    "execute transaction.upsert (card)": run({
      type: "transaction.upsert",
      id: "benchmark-upsert",
      transactionId: "benchmark-upsert",
      accountId: "amex",
      date: `${current}-12`,
      amount: -2_500,
      payee: "Benchmark",
      categoryId: "groceries",
    }),
    "execute register card payment": run({
      type: "transaction.upsert",
      transactionId: `${"benchmark-payment"}:cash`,
      id: "benchmark-payment",
      date: `${current}-28`,
      accountId: "checking",
      transferAccountId: card.id,
      amount: -Math.min(100, card.reserve),
      payee: "Credit card payment",
      status: "posted",
    }),
    "projectBook (current month)": () => projectBook(book, "alex", current),
    // Every execute starts by copying the whole household.
    "structuredClone (whole household)": () => structuredClone(book),
  };
}

for (const year of years.length ? years : [1, 5, 10]) {
  const months = year * 12;
  const book = syntheticBook({
    seed: 7,
    startMonth,
    months,
    transactionsPerMonth: 150,
    assignmentsPerMonth: 30,
  });
  console.log(`\n${year} year${year === 1 ? "" : "s"} (${months} months)`);
  for (const [name, run] of Object.entries(scenario(book, months))) {
    run();
    console.log(`  ${name.padEnd(36)} ${time(run).toFixed(1).padStart(8)} ms`);
  }
}
