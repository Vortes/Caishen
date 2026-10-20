import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  addMember,
  commandSchema,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";
import { prepareUserCommand } from "../../src/domain/user-command";
import { workspaceChangeLabel } from "../../src/server/services/workspace-history";

// tRPC batches calls made in the same tick into one request, so a path can
// name a procedure more than once ("budget.state,budget.state").
function procedures(route: Route) {
  const { pathname } = new URL(route.request().url());
  return pathname.slice(pathname.lastIndexOf("/") + 1).split(",");
}

// Each call's input, in the order the path names them.
function inputs(route: Route) {
  const request = route.request();
  const url = new URL(request.url());
  const raw: unknown =
    request.method() === "GET"
      ? JSON.parse(url.searchParams.get("input") ?? "{}")
      : request.postDataJSON();
  const batch = url.searchParams.has("batch")
    ? z.record(z.unknown()).parse(raw ?? {})
    : { 0: raw };
  return procedures(route).map((_, index) =>
    superjson.deserialize(
      batch[index] as ReturnType<typeof superjson.serialize>,
    ),
  );
}

type Answer = { data: unknown } | { error: string };

// Answers each call in the request in order, as the stream link expects.
async function respond(route: Route, answers: Answer[]) {
  const failure = (message: string, index: number) => ({
    message,
    code: -32603,
    data: {
      code: "INTERNAL_SERVER_ERROR",
      httpStatus: 500,
      path: procedures(route)[index],
    },
  });
  const results = answers.map((answer, index) =>
    "data" in answer
      ? { result: { data: answer.data } }
      : { error: failure(answer.error, index) },
  );
  if (route.request().headers()["trpc-accept"] !== "application/jsonl") {
    const serialized = answers.map((answer, index) =>
      "data" in answer
        ? { result: { data: superjson.serialize(answer.data) } }
        : { error: superjson.serialize(failure(answer.error, index)) },
    );
    await route.fulfill({
      status: answers.some((answer) => "error" in answer) ? 500 : 200,
      json: new URL(route.request().url()).searchParams.has("batch")
        ? serialized
        : serialized[0],
    });
    return;
  }
  const stream = jsonlStreamProducer({
    data: Object.fromEntries(results.map((result, index) => [index, result])),
    serialize: superjson.serialize,
  });
  await route.fulfill({
    contentType: "application/jsonl",
    body: await new Response(stream).text(),
  });
}

// Holds requests until the test lets them through.
function gate() {
  let waiting: Promise<void> | null = null;
  return {
    wait: () => waiting,
    hold: () => {
      let release!: () => void;
      waiting = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        waiting = null;
        release();
      };
    },
  };
}

const executeSchema = z.object({
  command: commandSchema,
  expectedRevision: z.number().int().nonnegative(),
});
const historySchema = z.object({
  direction: z.enum(["undo", "redo"]),
  expectedRevision: z.number().int().nonnegative(),
  operationId: z.string().uuid(),
});

// The app shell prototype, signed in, over a month with cash overspending
// (Dining), credit overspending (Household), money to spare (Gifts), and an
// unfunded target (Phone).
//
// The fixture plays the server with the real engine and no database:
// budget.execute runs each command over the book and records it as one undo
// step, and budget.changeHistory steps through those, each checking the
// revision like the server does. Every other write is refused and recorded
// in writes.
//
// With shared, a connected partner splits Rent with the user.
export async function openPrototype(
  page: Page,
  { shared = false }: { shared?: boolean } = {},
) {
  await clerkSetup();
  const [user] = z
    .array(z.object({ id: z.string(), email: z.string().email() }))
    .nonempty()
    .parse(
      JSON.parse(
        await readFile(
          process.env.E2E_USERS_FILE ?? "/tmp/caishen-e2e-users.json",
          "utf8",
        ),
      ),
    );
  const month = currentMonth();
  const date = `${month}-01`;
  let book = createBook(user.id, "Prototype fixture", month);
  if (shared) book = addMember(book, "prototype-partner", "Sam", month);
  const target = (amount: number) => ({
    cadence: "monthly" as const,
    behavior: "contribution" as const,
    amount,
    startMonth: month,
    snoozedMonths: [],
  });
  const initial: Command[] = [
    {
      type: "account.add",
      id: "seed-checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date,
      openingBalance: 100_000,
    },
    {
      type: "account.add",
      id: "seed-card",
      accountId: "card",
      name: "Visa",
      kind: "credit",
      date,
      openingBalance: 0,
    },
    ...(
      [
        ["rent", "Rent", "Bills"],
        ["phone", "Phone", "Bills"],
        ["household", "Household", "Bills"],
        ["dining", "Dining", "Everyday"],
        ["gifts", "Gifts", "Everyday"],
      ] as const
    ).map(([categoryId, name, group]): Command => ({
      type: "category.add",
      id: `seed-${categoryId}`,
      categoryId,
      name,
      group,
    })),
    {
      type: "target.set",
      id: "seed-phone-target",
      categoryId: "phone",
      target: target(6_500),
    },
    ...(
      [
        ["rent", 50_000],
        ["household", 13_701],
        ["dining", 20_000],
        ["gifts", 10_000],
      ] as const
    ).map(([categoryId, amount]): Command => ({
      type: "assign",
      id: `seed-assign-${categoryId}`,
      categoryId,
      month,
      amount,
    })),
    {
      type: "transaction.upsert",
      id: "seed-dinner",
      transactionId: "dinner",
      accountId: "checking",
      date,
      payee: "Bistro",
      amount: -28_015,
      categoryId: "dining",
    },
    {
      type: "transaction.upsert",
      id: "seed-lamp",
      transactionId: "lamp",
      accountId: "card",
      date,
      payee: "Lamp store",
      amount: -15_000,
      categoryId: "household",
    },
    ...(shared
      ? [
          {
            type: "shared.create",
            id: "seed-shared-rent",
            sharedCategoryId: "shared-rent",
            participants: [user.id, "prototype-partner"],
            weights: { [user.id]: 1, "prototype-partner": 1 },
            categoryIds: {
              [user.id]: "rent",
              "prototype-partner": "partner-rent",
            },
          } satisfies Command,
        ]
      : []),
  ];
  for (const command of initial) book = execute(book, user.id, command);
  type Step = { before: Book; after: Book; label: string };
  const undo: Step[] = [];
  const redo: Step[] = [];
  let revision = 0;
  const writes: string[] = [];
  const commands: Command[] = [];
  const executions: z.infer<typeof executeSchema>[] = [];
  const historyCalls: z.infer<typeof historySchema>[] = [];
  const executeGate = gate();
  const historyGate = gate();
  let rejectExecute: string | null = null;
  let rejectHistory: string | null = null;
  const state = (month: string): State => ({
    view: projectBook(book, user.id, month),
    revision,
    history: {
      undo: undo.at(-1)?.label ?? null,
      redo: redo.at(-1)?.label ?? null,
    },
    services: [],
    connections: [],
    evidence: [],
    imports: [],
  });
  const conflict = (expected: number) =>
    expected === revision
      ? null
      : { error: "Your budget changed. Refresh and try again." };
  await page.route("**/api/trpc/**", async (route) => {
    const names = procedures(route);
    const [name] = names;
    if (names.every((item) => item === "budget.state")) {
      await respond(
        route,
        inputs(route).map((input) => ({
          data: state(z.object({ month: z.string() }).parse(input).month),
        })),
      );
      return;
    }
    writes.push(names.join(","));
    if (names.length === 1 && name === "budget.execute") {
      const input = executeSchema.parse(inputs(route)[0]);
      executions.push(input);
      await executeGate.wait();
      if (rejectExecute) {
        const error = rejectExecute;
        rejectExecute = null;
        await respond(route, [{ error }]);
        return;
      }
      const stale = conflict(input.expectedRevision);
      if (stale) {
        await respond(route, [stale]);
        return;
      }
      const before = structuredClone(book);
      const budget = book.budgets[user.id]!;
      book = execute(book, user.id, prepareUserCommand(budget, input.command));
      commands.push(input.command);
      undo.push({
        before,
        after: structuredClone(book),
        label: workspaceChangeLabel([input.command]),
      });
      redo.length = 0;
      revision++;
      await respond(route, [{ data: { revision } }]);
      return;
    }
    if (names.length === 1 && name === "budget.changeHistory") {
      const input = historySchema.parse(inputs(route)[0]);
      historyCalls.push(input);
      await historyGate.wait();
      if (rejectHistory) {
        const error = rejectHistory;
        rejectHistory = null;
        await respond(route, [{ error }]);
        return;
      }
      const from = input.direction === "undo" ? undo : redo;
      const to = input.direction === "undo" ? redo : undo;
      const stale = conflict(input.expectedRevision);
      const step = from.at(-1);
      if (stale || !step) {
        await respond(route, [stale ?? { error: "There is nothing to undo." }]);
        return;
      }
      from.pop();
      to.push(step);
      // History restores the budget, not its audit trail.
      book = {
        ...structuredClone(
          input.direction === "undo" ? step.before : step.after,
        ),
        audit: book.audit,
      };
      revision++;
      await respond(route, [{ data: { revision, warning: null } }]);
      return;
    }
    await route.abort("blockedbyclient");
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/prototype/app-shell");
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  const summarize = (from: Book) => {
    const view = projectBook(from, user.id, month);
    return {
      readyToAssign: view.readyToAssign,
      category: (id: string) =>
        view.categories.find((category) => category.id === id)!,
      transaction: (id: string) =>
        view.budget.transactions.find((transaction) => transaction.id === id),
      transactions: view.budget.transactions,
    };
  };
  return {
    month,
    // Every write the page sent, by procedure path.
    writes,
    // The commands budget.execute ran, in order.
    commands,
    // Every budget.execute request, including refused ones, with the
    // revision it expected.
    executions,
    historyCalls,
    // The budget as the fixture's server holds it now.
    saved: () => summarize(book),
    // What the engine would show after these commands on top of the saved
    // budget.
    expected: (next: Command[]) =>
      summarize(
        next.reduce((value, command) => execute(value, user.id, command), book),
      ),
    // Hold saves or history changes until the returned release is called.
    holdExecute: executeGate.hold,
    holdHistory: historyGate.hold,
    rejectNextExecute: (message: string) => {
      rejectExecute = message;
    },
    rejectNextHistory: (message: string) => {
      rejectHistory = message;
    },
    // A change saved outside this session's history, like a partner's edit:
    // the revision moves on and, as on the server, the undo stack empties.
    editElsewhere: () => {
      revision++;
      undo.length = 0;
      redo.length = 0;
    },
    // The same, applying a command, like the user's own edit in another tab.
    changeElsewhere: (command: Command) => {
      book = execute(
        book,
        user.id,
        prepareUserCommand(book.budgets[user.id]!, command),
      );
      revision++;
      undo.length = 0;
      redo.length = 0;
    },
  };
}

export const pill = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`available in ${name}\\.`) });
// The toast corner, and the Undo a move's toast offers.
export const notifications = (page: Page) =>
  page.getByRole("region", { name: "Notifications" });
export const toastUndo = (page: Page) =>
  notifications(page).getByRole("button", { name: "Undo", exact: true });

// A move is saved once its toast can undo it: the server answered and the
// saved budget is back on screen.
export async function moveSaved(page: Page) {
  await expect(toastUndo(page)).toBeEnabled();
}

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
