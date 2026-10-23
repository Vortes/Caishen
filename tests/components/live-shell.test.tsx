import { screen, waitFor, within } from "@testing-library/react";
import { TRPCError } from "@trpc/server";
import { expect, test } from "vitest";
import { ZodError } from "zod";
import { SyncError } from "~/components/sync/transport";
import {
  deferred,
  findToast,
  refocus,
  renderShell,
  sent,
} from "./shell-harness";

const amount = () =>
  screen.getByRole("button", {
    name: /assigned to Gifts\. Edit assigned amount$/,
  });
const field = () =>
  screen.getByRole("textbox", { name: "Assigned amount for Gifts" });

test("an Assigned edit shows at once and saves the month's total", async () => {
  const gate = deferred<void>();
  const shell = await renderShell({
    execute: async (input, server) => {
      await gate.promise;
      return server.execute("owner", input);
    },
  });
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150{Enter}");

  // The editor closes and the plan shows the total before the server answers.
  expect(amount().getAttribute("aria-label")).toMatch(/^\$150\.00 assigned/);
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(sent(shell.execute)).toEqual([
    expect.objectContaining({
      type: "assign.set",
      categoryId: "gifts",
      month: "2026-10",
      amount: 15_000,
    }),
  ]);

  gate.resolve();
  const toast = await findToast("Gifts now has $150.00 assigned");
  expect(within(toast).getByRole("button", { name: "Undo" })).toBeTruthy();
});

const assignedLabel = () => amount().getAttribute("aria-label");

async function assign(
  user: Awaited<ReturnType<typeof renderShell>>["user"],
  total: string,
) {
  await user.click(amount());
  await user.clear(field());
  await user.type(field(), `${total}{Enter}`);
}

test("switching months shows the next month at once, without asking the server", async () => {
  const shell = await renderShell();
  const pulls = shell.server.pulls.length;
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  expect(screen.getByText("November 2026")).toBeTruthy();
  expect(assignedLabel()).toMatch(/^\$0\.00 assigned/);
  expect(screen.queryByRole("status")).toBeNull();
  await shell.user.click(
    screen.getByRole("button", { name: "Previous month" }),
  );
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  expect(shell.server.pulls.length).toBe(pulls);
});

test("undo and redo apply at once, from the toast or the keyboard, for changes made in this visit", async () => {
  const shell = await renderShell();
  // Changes saved before this visit can't be undone here.
  await shell.user.keyboard("{Meta>}z{/Meta}");
  expect(shell.execute).not.toHaveBeenCalled();

  await assign(shell.user, "150");
  const toast = await findToast("Gifts now has $150.00 assigned");
  await shell.user.click(within(toast).getByRole("button", { name: "Undo" }));
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  await findToast("Action undone.");

  await shell.user.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");
  expect(assignedLabel()).toMatch(/^\$150\.00 assigned/);
  await findToast("Action redone.");
  await shell.user.keyboard("{Meta>}z{/Meta}");
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  await findToast("Action undone.");
  expect(sent(shell.execute).map((command) => command.type)).toEqual([
    "assign.set",
    "revert",
    "revert",
    "revert",
  ]);
  expect(shell.server.book().budgets.owner!.assignments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ categoryId: "gifts", amount: 10_000 }),
    ]),
  );
});

test("a change the server refuses comes off the screen with the server's reason", async () => {
  const shell = await renderShell({
    execute: (input, server) => {
      if (input.command.type === "assign.set")
        throw new SyncError(
          "conflict",
          "Your partner changed this budget at the same time",
          server.revision,
        );
      return server.execute("owner", input);
    },
  });
  await assign(shell.user, "150");
  const toast = await findToast(
    "Your partner changed this budget at the same time",
  );
  expect(toast.getAttribute("role")).toBe("alert");
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  // Nothing is left to undo.
  await shell.user.keyboard("{Meta>}z{/Meta}");
  expect(shell.execute).toHaveBeenCalledTimes(1);
});

test("a change the server can't read comes off the screen and isn't sent again", async () => {
  const shell = await renderShell({
    execute: () => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        cause: new ZodError([
          {
            code: "invalid_type",
            expected: "number",
            received: "string",
            path: ["command", "amount"],
            message: "Expected number, received string",
          },
        ]),
      });
    },
  });
  await assign(shell.user, "150");
  const toast = await findToast(
    "Caishen couldn’t read this change, so it wasn’t saved.",
  );
  expect(toast.getAttribute("role")).toBe("alert");
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(shell.execute).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/^Saving paused/)).toBeNull();
});

test("signing out elsewhere stops saving and asks to sign in, keeping the change on screen", async () => {
  const shell = await renderShell({
    execute: () => {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    },
  });
  await assign(shell.user, "150");
  const toast = await findToast(
    "You’ve been signed out. Sign in to keep saving your changes.",
  );
  expect(toast.getAttribute("role")).toBe("alert");
  expect(
    within(toast).getByRole("link", { name: "Sign in" }).getAttribute("href"),
  ).toBe("/sign-in?redirect_url=/app");
  expect(assignedLabel()).toMatch(/^\$150\.00 assigned/);
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  expect(shell.execute).toHaveBeenCalledTimes(1);
});

test("while the server can't be reached, changes stay on screen, leaving warns, and saving resumes on Try again", async () => {
  let online = false;
  const shell = await renderShell({
    execute: (input, server) => {
      if (!online) throw new Error("Network unavailable");
      return server.execute("owner", input);
    },
  });
  await assign(shell.user, "150");
  const paused = await findToast(/^Saving paused/, { timeout: 6_000 });
  expect(paused.getAttribute("role")).toBe("alert");
  expect(within(paused).queryByRole("button", { name: "Dismiss" })).toBeNull();
  expect(assignedLabel()).toMatch(/^\$150\.00 assigned/);
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);

  online = true;
  await shell.user.click(
    within(paused).getByRole("button", { name: "Try again" }),
  );
  await findToast("Gifts now has $150.00 assigned");
  expect(screen.queryByText(/^Saving paused/)).toBeNull();
  // Every attempt carried the same operation, which saved once.
  expect(new Set(sent(shell.execute).map((command) => command.id)).size).toBe(
    1,
  );
  expect(shell.server.revision).toBe(1);
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

test("changes made elsewhere show when the window regains focus", async () => {
  const shell = await renderShell();
  shell.server.act("owner", {
    type: "assign.set",
    id: "other-tab",
    categoryId: "gifts",
    month: "2026-10",
    amount: 4_000,
  });
  await refocus();
  await waitFor(() => expect(assignedLabel()).toMatch(/^\$40\.00 assigned/));
});

test("a budget that can't refresh says so and catches up on Try again", async () => {
  let reachable = false;
  const shell = await renderShell({
    pull: (input, server) => {
      if (!reachable && input.since !== null)
        throw new Error("Network unavailable");
      return server.pull("owner", input);
    },
  });
  shell.server.act("owner", {
    type: "assign.set",
    id: "other-tab",
    categoryId: "gifts",
    month: "2026-10",
    amount: 4_000,
  });
  await refocus();
  const toast = await findToast(/^Your budget couldn’t refresh/, {
    timeout: 6_000,
  });
  expect(assignedLabel()).toMatch(/^\$100\.00 assigned/);
  reachable = true;
  await shell.user.click(
    within(toast).getByRole("button", { name: "Try again" }),
  );
  await waitFor(() => expect(assignedLabel()).toMatch(/^\$40\.00 assigned/));
  expect(screen.queryByText(/^Your budget couldn’t refresh/)).toBeNull();
});

test("an app older than the server asks for a reload", async () => {
  const shell = await renderShell();
  shell.server.requiredBuild = "2:next";
  await refocus();
  const toast = await findToast(
    "Caishen has been updated. Reload to keep saving your changes.",
  );
  expect(within(toast).getByRole("button", { name: "Reload" })).toBeTruthy();
});

test("a change made elsewhere to the same amount takes Undo off its toast", async () => {
  const shell = await renderShell();
  await assign(shell.user, "150");
  const toast = await findToast("Gifts now has $150.00 assigned");
  shell.server.act("owner", {
    type: "assign.set",
    id: "other-tab",
    categoryId: "gifts",
    month: "2026-10",
    amount: 4_000,
  });
  await refocus();
  await waitFor(() => expect(assignedLabel()).toMatch(/^\$40\.00 assigned/));
  expect(within(toast).queryByRole("button", { name: "Undo" })).toBeNull();
  await shell.user.keyboard("{Meta>}z{/Meta}");
  expect(shell.execute).toHaveBeenCalledTimes(1);
});
