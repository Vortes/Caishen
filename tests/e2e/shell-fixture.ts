import { createClerkClient } from "@clerk/backend";
import {
  clerk,
  clerkSetup,
  setupClerkTestingToken,
} from "@clerk/testing/playwright";
import { expect, test as base, type Page } from "@playwright/test";
import { createTRPCClient, httpLink } from "@trpc/client";
import { randomUUID } from "node:crypto";
import superjson from "superjson";

import {
  CLIENT_FORMAT,
  CLIENT_FORMAT_HEADER,
} from "../../src/domain/client-format";
import type { Command } from "../../src/domain/engine";
import { PrismaClient } from "../../src/generated/prisma/index.js";
import type { AppRouter } from "../../src/server/api/root";
import { e2eEnvironment, shellPath } from "./environment";
import { RunJournal, cleanupRun } from "./cleanup";
import { cleanupServices } from "./cleanup-clients";
import { calendarAt } from "./calendar";
import { showMonth } from "./shell-controls";

export { expect, shellPath };

type BudgetOptions = {
  name?: string;
  category?: string;
  account?: string;
  cash?: number;
  purchase?: { payee: string; amount: number; reviewed?: boolean };
};
export type TestBudget = {
  userId: string;
  email: string;
  name: string;
  category: string;
  account: string;
  month: string;
  date: string;
  purchaseId: string;
};
type Budgets = {
  create: (options?: BudgetOptions) => Promise<TestBudget>;
  signIn: (page: Page, budget: TestBudget) => Promise<void>;
  signOut: (page: Page) => Promise<void>;
};

// No saved auth files, shared identities, direct database seeding, or budget
// interception. The only database access verifies the target and removes
// records owned by identities created by this fixture invocation.
export const test = base.extend<{ budgets: Budgets; budget: TestBudget }>({
  budgets: async ({ browser, context: journeyContext, baseURL }, provide) => {
    const environment = e2eEnvironment(process.env);
    if (baseURL !== environment.baseURL)
      throw new Error(
        "The browser and managed test server must use the same origin.",
      );
    await clerkSetup({ dotenv: false });
    const auth = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
    const db = new PrismaClient();
    const journal = await RunJournal.create();
    const calendar = calendarAt(new Date());
    const { month } = calendar;
    const signIn = async (page: Page, budget: TestBudget) => {
      await setupClerkTestingToken({ page });
      await clerk.signIn({ page, emailAddress: budget.email });
      await expect(
        page.getByRole("heading", { name: "Plan", exact: true }),
      ).toBeVisible();
      await showMonth(page, budget.month);
    };
    const signOut = async (page: Page) => {
      await clerk.signOut({ page, signOutOptions: { redirectUrl: shellPath } });
    };
    try {
      await provide({
        signIn,
        signOut,
        create: async (options = {}) => {
          const email = await journal.reserveIdentity();
          const user = await auth.users.createUser({
            emailAddress: [email],
            password: `Caishen!${randomUUID()}`,
            firstName: "Caishen E2E",
            privateMetadata: { caishenE2ERun: journal.runId },
          });
          await journal.recordIdentity(email, user.id);
          const budget: TestBudget = {
            userId: user.id,
            email,
            ...calendar,
            name: options.name ?? "Critical journey budget",
            category: options.category ?? "Groceries",
            account: options.account ?? "Checking",
            purchaseId: randomUUID(),
          };
          const context = await browser.newContext({
            baseURL,
            timezoneId: "America/Los_Angeles",
            locale: "en-US",
          });
          try {
            const page = await context.newPage();
            await setupClerkTestingToken({ page });
            await page.goto(shellPath);
            await clerk.signIn({ page, emailAddress: email });
            await expect(
              page.getByText("You don’t have a budget yet."),
            ).toBeVisible();
            const api = createTRPCClient<AppRouter>({
              links: [
                httpLink({
                  url: `${baseURL}/api/trpc`,
                  transformer: superjson,
                  headers: { [CLIENT_FORMAT_HEADER]: String(CLIENT_FORMAT) },
                  fetch: async (url, options) => {
                    const address =
                      typeof url === "string"
                        ? url
                        : url instanceof URL
                          ? url.href
                          : url.url;
                    const response = await context.request.fetch(address, {
                      method: options?.method,
                      headers: Object.fromEntries(
                        new Headers(options?.headers),
                      ),
                      data:
                        typeof options?.body === "string"
                          ? options.body
                          : undefined,
                    });
                    return new Response(await response.text(), {
                      status: response.status(),
                      headers: response.headers(),
                    });
                  },
                }),
              ],
            });
            let { revision } = await api.budget.onboard.mutate({
              name: budget.name,
              month,
              timezone: "America/Los_Angeles",
            });
            // A mismatched server/database must fail before seeding financial data.
            await db.workspaceMember.findUniqueOrThrow({
              where: { clerkUserId: user.id },
            });
            const commands: Command[] = [
              {
                type: "account.add",
                id: randomUUID(),
                accountId: "checking",
                name: budget.account,
                kind: "cash",
                date: budget.date,
                openingBalance: options.cash ?? 100_000,
              },
              {
                type: "category.add",
                id: randomUUID(),
                categoryId: "groceries",
                name: budget.category,
              },
              {
                type: "category.add",
                id: randomUUID(),
                categoryId: "gifts",
                name: "Gifts",
              },
              {
                type: "assign",
                id: randomUUID(),
                categoryId: "groceries",
                month,
                amount: 20_000,
              },
              {
                type: "assign",
                id: randomUUID(),
                categoryId: "gifts",
                month,
                amount: 10_000,
              },
            ];
            if (options.purchase)
              commands.push({
                type: "transaction.upsert",
                id: randomUUID(),
                transactionId: budget.purchaseId,
                accountId: "checking",
                categoryId: "groceries",
                date: budget.date,
                payee: options.purchase.payee,
                amount: -options.purchase.amount,
                status: "posted",
                reviewed: options.purchase.reviewed ?? true,
              });
            for (const command of commands) {
              ({ revision } = await api.budget.execute.mutate({
                command,
                baseRevision: revision,
                clientId: "e2e-fixture",
              }));
            }
            return budget;
          } finally {
            await context.close();
          }
        },
      });
    } finally {
      // Attempt every cleanup even after partial setup or an assertion failure.
      const failures: unknown[] = [];
      try {
        await journeyContext.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        await cleanupRun(journal, cleanupServices(auth, db));
      } catch (error) {
        failures.push(error);
      } finally {
        await db.$disconnect();
      }
      if (failures.length)
        throw new AggregateError(
          failures,
          `E2E cleanup failed for run ${journal.runId}. Use npm run test:e2e:cleanup -- ${journal.runId}.`,
        );
    }
  },
  budget: async ({ budgets, page }, provide) => {
    const budget = await budgets.create();
    await page.goto(shellPath);
    await budgets.signIn(page, budget);
    await provide(budget);
  },
});
