import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { findToast, refocus, renderShell } from "./shell-harness";

const amount = () =>
  screen.getByRole("button", {
    name: /assigned to Gifts\. Edit assigned amount$/,
  });
const field = () =>
  screen.getByRole("textbox", { name: "Assigned amount for Gifts" });

test("Enter followed by blur cannot submit an assignment twice", async () => {
  const shell = await renderShell();
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150");
  const input = field();
  fireEvent.submit(input.closest("form")!);
  fireEvent.blur(input);
  await waitFor(() => expect(amount().textContent).toBe("$150.00"));
  await findToast("Gifts now has $150.00 assigned");
  expect(screen.getByText("$850.00")).toBeTruthy();
  await shell.reload();
  expect(amount().textContent).toBe("$150.00");
  expect(screen.getByText("$850.00")).toBeTruthy();
});

test("leaving an amount unchanged preserves an assignment changed elsewhere", async () => {
  const shell = await renderShell();
  await shell.user.click(amount());
  shell.server.act("owner", {
    type: "assign.set",
    id: "other-tab",
    categoryId: "gifts",
    month: "2026-10",
    amount: 13_000,
  });
  await refocus();
  await screen.findByText("$870.00");
  await shell.user.keyboard("{Enter}");
  await waitFor(() => expect(amount().textContent).toBe("$130.00"));
  await shell.reload();
  expect(amount().textContent).toBe("$130.00");
});

test("an amount that isn't money stays in the field with what's wrong", async () => {
  const shell = await renderShell();
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "lots{Enter}");
  expect(field()).toHaveProperty("value", "lots");
  expect(field().getAttribute("aria-invalid")).toBe("true");
  await shell.user.keyboard("{Escape}");
  await shell.reload();
  expect(amount().textContent).toBe("$100.00");
});

test("changing month discards an unsaved assignment instead of applying it to the new month", async () => {
  const shell = await renderShell();
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150");
  // Deliver the month change while the field still owns focus. Blur-to-save
  // is covered separately.
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(amount().textContent).toBe("$0.00"));
  expect(
    screen.queryByRole("textbox", { name: "Assigned amount for Gifts" }),
  ).toBeNull();
  await shell.reload();
  expect(amount().textContent).toBe("$100.00");
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  expect(amount().textContent).toBe("$0.00");
});
