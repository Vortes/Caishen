import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  createBook,
  execute,
  projectBook,
  type Command,
} from "../../src/domain/engine";

// tRPC batches calls made in the same tick into one request, so a path can
// name a procedure more than once ("budget.state,budget.state").
function procedures(route: Route) {
  const { pathname } = new URL(route.request().url());
  return pathname.slice(pathname.lastIndexOf("/") + 1).split(",");
}

// Answers every call in the request with the same value.
async function respond(route: Route, value: unknown) {
  const count = procedures(route).length;
  if (route.request().headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          index,
          { result: { data: value } },
        ]),
      ),
      serialize: superjson.serialize,
    });
    await route.fulfill({
      contentType: "application/jsonl",
      body: await new Response(stream).text(),
    });
    return;
  }
  const result = { result: { data: superjson.serialize(value) } };
  await route.fulfill({
    json: new URL(route.request().url()).searchParams.has("batch")
      ? Array.from({ length: count }, () => result)
      : result,
  });
}

// The app shell prototype, signed in, over a month served through the real
// engine with no database.
//
// A month with cash overspending (Dining), credit overspending (Household),
// money to spare (Gifts), and an unfunded target (Phone), served through the
// real engine with no database. The prototype only reads it: any write fails
// the test.
export async function openPrototype(page: Page) {
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
  ];
  for (const command of initial) book = execute(book, user.id, command);
  const writes: string[] = [];
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (procedures(route).every((name) => name === "budget.state")) {
      const state: State = {
        view: projectBook(book, user.id, month),
        revision: 0,
        history: { undo: null, redo: null },
        services: [],
        connections: [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    writes.push(url.pathname);
    await route.abort("blockedbyclient");
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/prototype/app-shell");
  await expect(
    page.getByRole("heading", { name: "Plan", exact: true }),
  ).toBeVisible();
  return {
    writes,
    // What the engine would show after these commands, to check the
    // simulation against.
    expected: (commands: Command[]) => {
      let next = book;
      for (const command of commands) next = execute(next, user.id, command);
      const view = projectBook(next, user.id, month);
      return {
        readyToAssign: view.readyToAssign,
        category: (id: string) =>
          view.categories.find((category) => category.id === id)!,
      };
    },
    month,
  };
}

export const pill = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`available in ${name}\\.`) });
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
