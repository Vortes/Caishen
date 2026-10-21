import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { deferred, openPurchase, renderShell } from "./shell-harness";

test("an outstanding save blocks repeated submission and retains the draft on failure", async () => {
  const pending = deferred<{ revision: number }>();
  const shell = await renderShell({ execute: () => pending.promise });
  const form = await openPurchase(shell.user);
  await shell.user.click(within(form).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(within(form).getByRole("button", { name: "Saving…" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    within(form).getByRole("button", { name: "Save and add another" }),
  ).toHaveProperty("disabled", true);
  fireEvent.submit(form);
  await shell.user.keyboard("{Enter}");
  expect(shell.execute).toHaveBeenCalledTimes(1);
  pending.reject(new Error("Save refused"));
  await screen.findByText(
    "Not saved. Your changes are still here, so you can try again.",
  );
  expect(within(form).getByLabelText("Payee", { exact: true })).toHaveProperty(
    "value",
    "Market",
  );
  expect(
    within(form).getByLabelText("Outflow", { exact: true }),
  ).toHaveProperty("value", "12.50");
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
