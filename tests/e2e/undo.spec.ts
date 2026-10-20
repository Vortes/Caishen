import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { jsonlStreamProducer } from "@trpc/server/unstable-core-do-not-import";
import { readFile } from "node:fs/promises";
import superjson from "superjson";
import { z } from "zod";

import { currentMonth } from "../../src/components/budget/format";
import type { State } from "../../src/components/budget/types";
import {
  commandSchema,
  createBook,
  execute,
  projectBook,
  type Book,
  type Command,
} from "../../src/domain/engine";

const mutationSchema = z.object({
  command: commandSchema,
  expectedRevision: z.number().int().nonnegative(),
});
const historySchema = z.object({
  direction: z.enum(["undo", "redo"]),
  expectedRevision: z.number().int().nonnegative(),
  operationId: z.string().uuid(),
});

async function respond(route: Route, value: unknown) {
  if (route.request().headers()["trpc-accept"] === "application/jsonl") {
    const stream = jsonlStreamProducer({
      data: { 0: { result: { data: value } } },
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
      ? [result]
      : result,
  });
}

function requestInput(route: Route) {
  const url = new URL(route.request().url());
  const payload: unknown = route.request().postDataJSON();
  const serialized = (
    url.searchParams.has("batch")
      ? z.record(z.unknown()).parse(payload)["0"]
      : payload
  ) as ReturnType<typeof superjson.serialize>;
  return superjson.deserialize(serialized);
}

async function openFixture(
  page: Page,
  options: { openingBalance?: number } = {},
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
  let book = createBook(user.id, "Undo fixture", month);
  const seed: Command[] = [
    {
      type: "account.add",
      id: "seed-checking",
      accountId: "checking",
      name: "Checking",
      kind: "cash",
      date: `${month}-01`,
      openingBalance: options.openingBalance ?? 100_000,
    },
    {
      type: "category.add",
      id: "seed-groceries",
      categoryId: "groceries",
      name: "Groceries",
      group: "Everyday",
    },
  ];
  for (const command of seed) book = execute(book, user.id, command);

  // Keep the fixture's saved history across navigation and reloads, just as the
  // server does, while exercising real accounting projections without a DB.
  type Entry = { before: Book; after: Book; label: string };
  const undo: Entry[] = [];
  const redo: Entry[] = [];
  const commands: Command[] = [];
  const historyCalls: z.infer<typeof historySchema>[] = [];
  let revision = 0;
  let rejectHistory = false;
  let historyWait: Promise<void> | null = null;
  let stateWait: Promise<void> | null = null;
  const hold = (kind: "history" | "state") => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (kind === "history") historyWait = promise;
    else stateWait = promise;
    return () => {
      if (kind === "history") historyWait = null;
      else stateWait = null;
      release();
    };
  };

  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/budget.state")) {
      if (stateWait) await stateWait;
      const serialized: unknown = JSON.parse(
        url.searchParams.get("input") ?? "{}",
      );
      const input = z
        .object({ month: z.string() })
        .parse(
          superjson.deserialize(
            (url.searchParams.has("batch")
              ? z.record(z.unknown()).parse(serialized)["0"]
              : serialized) as ReturnType<typeof superjson.serialize>,
          ),
        );
      const state: State = {
        view: projectBook(book, user.id, input.month),
        revision,
        history: {
          undo: undo.at(-1)?.label ?? null,
          redo: redo.at(-1)?.label ?? null,
        },
        services: [],
        connections: [],
        evidence: [],
        imports: [],
      };
      await respond(route, state);
      return;
    }
    if (url.pathname.endsWith("/budget.execute")) {
      const input = mutationSchema.parse(requestInput(route));
      expect(input.expectedRevision).toBe(revision);
      const before = structuredClone(book);
      book = execute(book, user.id, input.command);
      commands.push(input.command);
      undo.push({
        before,
        after: structuredClone(book),
        label:
          input.command.type === "settings.update"
            ? "Update budget settings"
            : "Assign money",
      });
      redo.length = 0;
      revision++;
      await respond(route, { revision });
      return;
    }
    if (url.pathname.endsWith("/budget.changeHistory")) {
      const input = historySchema.parse(requestInput(route));
      historyCalls.push(input);
      if (historyWait) await historyWait;
      expect(input.expectedRevision).toBe(revision);
      if (rejectHistory) {
        rejectHistory = false;
        const error = {
          message: "Undo is temporarily unavailable. Try again.",
          code: -32603,
          data: {
            code: "INTERNAL_SERVER_ERROR",
            httpStatus: 500,
            path: "budget.changeHistory",
          },
        };
        if (route.request().headers()["trpc-accept"] === "application/jsonl") {
          const stream = jsonlStreamProducer({
            data: { 0: { error } },
            serialize: superjson.serialize,
          });
          await route.fulfill({
            contentType: "application/jsonl",
            body: await new Response(stream).text(),
          });
          return;
        }
        const result = { error: superjson.serialize(error) };
        await route.fulfill({
          status: 500,
          json: url.searchParams.has("batch") ? [result] : result,
        });
        return;
      }
      const source = input.direction === "undo" ? undo : redo;
      const destination = input.direction === "undo" ? redo : undo;
      const entry = source.pop();
      expect(entry).toBeDefined();
      book = {
        ...structuredClone(
          input.direction === "undo" ? entry!.before : entry!.after,
        ),
        audit: book.audit,
      };
      destination.push(entry!);
      revision++;
      await respond(route, { revision });
      return;
    }
    await route.abort("blockedbyclient");
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: user.email });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your budget", exact: true }),
  ).toBeVisible();
  return {
    commands,
    historyCalls,
    assigned: () =>
      projectBook(book, user.id, month).categories.find(
        (category) => category.id === "groceries",
      )!.assigned,
    rejectNextHistory: () => {
      rejectHistory = true;
    },
    holdHistory: () => hold("history"),
    holdState: () => hold("state"),
  };
}

const undoButton = (page: Page) =>
  page.getByRole("button", { name: "Undo", exact: true });
const redoButton = (page: Page) =>
  page.getByRole("button", { name: "Redo", exact: true });

async function assign(page: Page, amount: string) {
  const assigned = page.getByTitle("Assign money to Groceries", {
    exact: true,
  });
  await assigned.click();
  const editor = page.getByLabel("Assigned amount for Groceries", {
    exact: true,
  });
  await editor.fill(amount);
  await editor.press("Enter");
  await expect(editor).not.toBeVisible();
  await expect(assigned).toHaveText(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(amount)),
  );
  await expect(assigned).toBeEnabled();
  await expect(undoButton(page)).toBeEnabled();
}

test("saved actions undo and redo across workspace tabs and reloads", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await expect(undoButton(page)).toBeDisabled();
  await expect(redoButton(page)).toBeDisabled();
  await assign(page, "20.00");
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.keyboard.press("Meta+z");
  await expect.poll(fixture.assigned).toBe(0);
  await expect(redoButton(page)).toBeEnabled();
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(undoButton(page)).toBeEnabled();
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await expect(
    page.getByTitle("Assign money to Groceries", { exact: true }),
  ).toHaveText("$20.00");
  await page.reload();
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(0);
  await expect(redoButton(page)).toBeEnabled();
  await page.keyboard.press("Control+y");
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(undoButton(page)).toBeEnabled();
  expect(fixture.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "redo",
    "undo",
    "redo",
  ]);
  expect(fixture.historyCalls.map((call) => call.expectedRevision)).toEqual([
    1, 2, 3, 4,
  ]);
});

test("a successful new action clears the abandoned redo branch", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  await assign(page, "30.00");
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(redoButton(page)).toBeEnabled();
  await assign(page, "40.00");
  await expect(redoButton(page)).toBeDisabled();
  await page.keyboard.press("Meta+Shift+z");
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(redoButton(page)).toBeEnabled();
  expect(fixture.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "undo",
  ]);
});

test("editing fields retain their native undo and redo shortcuts", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  const input = page.getByRole("textbox", {
    name: "Search categories",
    exact: true,
  });
  await input.focus();
  await page.keyboard.insertText("groceries");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(input).toHaveValue("");

  const editingShortcutsPreserved = await page.evaluate(() => {
    const elements = [
      document.createElement("input"),
      document.createElement("textarea"),
      document.createElement("div"),
    ];
    elements[2]!.contentEditable = "true";
    return elements.every((element) => {
      document.body.append(element);
      element.focus();
      const preserved = [
        { key: "z", metaKey: true },
        { key: "z", metaKey: true, shiftKey: true },
        { key: "z", ctrlKey: true },
        { key: "y", ctrlKey: true },
      ].every((keys) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            ...keys,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      element.remove();
      return preserved;
    });
  });
  expect(editingShortcutsPreserved).toBe(true);
  expect(fixture.historyCalls).toHaveLength(0);
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(0);
});

test("modal and transaction drafts block saved-action shortcuts", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  await page.getByRole("button", { name: "Add category", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Meta+z");
  await expect(
    page.getByRole("button", {
      name: "Undo",
      exact: true,
      includeHidden: true,
    }),
  ).toBeDisabled();
  expect(fixture.historyCalls).toHaveLength(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "All accounts", exact: true }).click();
  await page.locator(".register-add-transaction").click();
  const editor = page.locator(".transaction-editor-body");
  await editor.getByRole("button", { name: "Save", exact: true }).focus();
  await page.keyboard.press("Meta+z");
  await expect(undoButton(page)).toBeDisabled();
  expect(fixture.historyCalls).toHaveLength(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(undoButton(page)).toBeEnabled();
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(0);
});

test("repeated keys and in-flight updates cannot apply a second undo", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  await assign(page, "30.00");
  const release = fixture.holdHistory();
  try {
    const repeatedKeyPreserved = await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          metaKey: true,
          repeat: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(repeatedKeyPreserved).toBe(true);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => fixture.historyCalls.length).toBe(1);
    await expect(undoButton(page)).toBeDisabled();
    await page.keyboard.press("Meta+z");
    await page.keyboard.press("Control+z");
    expect(fixture.historyCalls).toHaveLength(1);
  } finally {
    release();
  }
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(undoButton(page)).toBeEnabled();
  expect(fixture.historyCalls).toHaveLength(1);

  const releaseState = fixture.holdState();
  try {
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await expect(page.locator("#main-content")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await page.keyboard.press("Meta+z");
    await expect(undoButton(page)).toBeDisabled();
    expect(fixture.historyCalls).toHaveLength(1);
  } finally {
    releaseState();
  }
  await expect(undoButton(page)).toBeEnabled();
});

test("a rejected undo preserves the saved action and can be retried", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  fixture.rejectNextHistory();
  await undoButton(page).click();
  await expect(page.locator('.workspace-notice[role="alert"]')).toContainText(
    "Undo is temporarily unavailable. Try again.",
  );
  await expect(undoButton(page)).toBeEnabled();
  await expect(redoButton(page)).toBeDisabled();
  expect(fixture.assigned()).toBe(2_000);
  await undoButton(page).click();
  await expect.poll(fixture.assigned).toBe(0);
  await expect(redoButton(page)).toBeEnabled();
  expect(fixture.historyCalls).toHaveLength(2);
});

test("settings fields stay synchronized when saved preferences undo and redo", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Budget name", exact: true });
  const email = page.getByRole("checkbox", {
    name: /Send my daily review email/,
  });
  const initialName = await name.inputValue();
  const initialEmail = await email.isChecked();
  await name.fill("Updated budget name");
  await email.setChecked(!initialEmail);
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(undoButton(page)).toBeEnabled();
  await expect(name).toHaveValue("Updated budget name");
  await expect(email).toBeChecked({ checked: !initialEmail });

  await undoButton(page).click();
  await expect(name).toHaveValue(initialName);
  await expect(email).toBeChecked({ checked: initialEmail });
  await expect(redoButton(page)).toBeEnabled();

  await redoButton(page).click();
  await expect(name).toHaveValue("Updated budget name");
  await expect(email).toBeChecked({ checked: !initialEmail });
  await expect(undoButton(page)).toBeEnabled();
  expect(fixture.historyCalls.map((call) => call.direction)).toEqual([
    "undo",
    "redo",
  ]);
});

test("mobile undo and redo close navigation and reveal the restored budget", async ({
  page,
}) => {
  const fixture = await openFixture(page);
  await assign(page, "20.00");
  await page.setViewportSize({ width: 390, height: 844 });
  const navigation = page.getByRole("dialog", {
    name: "Budget navigation",
    exact: true,
  });
  const opener = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await opener.click();
  await navigation.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect.poll(fixture.assigned).toBe(0);
  await expect(
    page.getByTitle("Assign money to Groceries", { exact: true }),
  ).toHaveText("$0.00");

  await opener.click();
  await navigation.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect.poll(fixture.assigned).toBe(2_000);
  await expect(
    page.getByTitle("Assign money to Groceries", { exact: true }),
  ).toHaveText("$20.00");
});

test("assigned amounts calculate additions and subtractions as one undoable action", async ({
  page,
}) => {
  const fixture = await openFixture(page, { openingBalance: 500_000 });
  await assign(page, "1000");
  expect(fixture.assigned()).toBe(100_000);
  expect(fixture.commands).toHaveLength(1);

  const assigned = page.getByTitle("Assign money to Groceries", {
    exact: true,
  });
  const editor = page.getByLabel("Assigned amount for Groceries", {
    exact: true,
  });
  await assigned.click();
  await editor.fill("600.00+1000");
  await editor.press("Enter");
  await expect(editor).not.toBeVisible();
  await expect(assigned).toHaveText("$1,600.00");
  await expect(assigned).toBeEnabled();
  expect(fixture.assigned()).toBe(160_000);
  expect(fixture.commands).toHaveLength(2);

  await undoButton(page).click();
  await expect(assigned).toHaveText("$1,000.00");
  await expect(redoButton(page)).toBeEnabled();
  await redoButton(page).click();
  await expect(assigned).toHaveText("$1,600.00");
  await expect(assigned).toBeEnabled();
  expect(fixture.commands).toHaveLength(2);

  await assigned.click();
  await editor.fill("1600-25.50");
  await page
    .getByRole("textbox", { name: "Search categories", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(assigned).toHaveText("$1,574.50");
  await expect(assigned).toBeEnabled();
  expect(fixture.assigned()).toBe(157_450);
  expect(fixture.commands).toHaveLength(3);

  await assigned.click();
  await editor.fill("1600+");
  await editor.press("Enter");
  await expect(editor).toHaveValue("1600+");
  const error = page.locator('.workspace-notice[role="alert"]');
  await expect(error).toContainText(
    "Enter an amount or add/subtract amounts, such as 600+1000.",
  );
  expect(fixture.assigned()).toBe(157_450);
  expect(fixture.commands).toHaveLength(3);
  await editor.fill("1600-20");
  await editor.press("Enter");
  await expect(editor).not.toBeVisible();
  await expect(assigned).toHaveText("$1,580.00");
  await expect(assigned).toBeEnabled();
  await expect(error).not.toBeVisible();
  expect(fixture.assigned()).toBe(158_000);
  expect(fixture.commands).toHaveLength(4);

  await assigned.click();
  await editor.fill("1580+");
  await editor.press("Enter");
  await expect(error).toBeVisible();
  await editor.fill("1580");
  await editor.press("Tab");
  await expect(editor).not.toBeVisible();
  await expect(error).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Groceries available/ }),
  ).toBeFocused();
  expect(fixture.commands).toHaveLength(4);
});
