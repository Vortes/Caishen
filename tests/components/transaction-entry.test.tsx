import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SyncError } from "~/components/sync/transport";
import {
  deferred,
  findToast,
  openPurchase,
  renderShell,
} from "./shell-harness";

test("a save closes the editor at once, and a draft the server refuses comes back", async () => {
  const gate = deferred<void>();
  const shell = await renderShell({
    execute: async (input, server) => {
      await gate.promise;
      throw new SyncError(
        "rejected",
        "This account was closed on another device.",
        server.revision,
      );
    },
  });
  const form = await openPurchase(shell.user);
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  expect(screen.getByText("Market")).toBeTruthy();
  gate.resolve();

  await findToast("This account was closed on another device.");
  const restored = await screen.findByRole("form", {
    name: "New transaction",
  });
  expect(
    within(restored).getByText(
      "Not saved. Your changes are still here, so you can try again.",
    ),
  ).toBeTruthy();
  expect(
    within(restored).getByLabelText("Payee", { exact: true }),
  ).toHaveProperty("value", "Market");
  expect(
    within(restored).getByLabelText("Outflow", { exact: true }),
  ).toHaveProperty("value", "12.50");
  expect(shell.execute).toHaveBeenCalledTimes(1);
});

test("a dirty transaction holds shell navigation until canceled; a pristine editor can leave", async () => {
  const shell = await renderShell();
  const form = await openPurchase(shell.user);
  await shell.user.click(screen.getByRole("button", { name: "Plan" }));
  expect(screen.getByRole("heading", { name: "Checking" })).toBeTruthy();
  expect(
    within(form).getByText("Save or cancel this transaction first."),
  ).toBeTruthy();
  expect(within(form).getByLabelText("Payee", { exact: true })).toHaveProperty(
    "value",
    "Market",
  );
  expect(shell.execute).not.toHaveBeenCalled();
  await shell.user.click(within(form).getByRole("button", { name: "Cancel" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Add transaction" }),
  );
  await shell.user.keyboard("{Escape}");
  await shell.user.click(screen.getByRole("button", { name: "Plan" }));
  expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
  expect(screen.queryByRole("form", { name: "New transaction" })).toBeNull();
  expect(shell.execute).not.toHaveBeenCalled();
});
