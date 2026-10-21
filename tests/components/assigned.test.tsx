import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { deferred, renderShell, stateFixture } from "./shell-harness";

const amount = () =>
  screen.getByRole("button", {
    name: /assigned to Gifts\. Edit assigned amount$/,
  });
const field = () =>
  screen.getByRole("textbox", { name: "Assigned amount for Gifts" });

test("a placeholder month blocks assignment until that month's data arrives", async () => {
  const next = deferred<ReturnType<typeof stateFixture>>();
  const shell = await renderShell({
    read: (month) => (month === "2026-11" ? next.promise : stateFixture()),
  });
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(shell.read).toHaveBeenCalledWith("2026-11"));
  expect(amount().getAttribute("aria-disabled")).toBe("true");
  await shell.user.click(amount());
  expect(
    screen.queryByRole("textbox", { name: "Assigned amount for Gifts" }),
  ).toBeNull();
  expect(shell.execute).not.toHaveBeenCalled();
  next.resolve(stateFixture({ month: "2026-11" }));
  await waitFor(() =>
    expect(amount().hasAttribute("aria-disabled")).toBe(false),
  );
  await shell.user.click(amount());
  expect(field()).toHaveProperty("value", "0.00");
});

test("a failed refresh blocks editing until Try again obtains fresh data", async () => {
  const shell = await renderShell();
  shell.read.mockImplementation(() => {
    throw new Error("Refresh unavailable");
  });
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150{Enter}");
  await screen.findByText(
    "Your budget couldn’t refresh. Refresh before making more changes.",
  );
  expect(amount().getAttribute("aria-disabled")).toBe("true");
  await shell.user.click(amount());
  expect(
    screen.queryByRole("textbox", { name: "Assigned amount for Gifts" }),
  ).toBeNull();
  expect(shell.execute).toHaveBeenCalledTimes(1);
  shell.read.mockReturnValue(stateFixture({ assigned: 15_000, revision: 6 }));
  await shell.user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(amount().hasAttribute("aria-disabled")).toBe(false),
  );
  await shell.user.click(amount());
  expect(field()).toHaveProperty("value", "150.00");
});

test("retrying an earlier failed total reuses its operation after another total and a row remount", async () => {
  const shell = await renderShell({
    execute: () => {
      throw new Error("Save refused");
    },
  });
  await shell.user.click(amount());
  for (const total of ["150", "160"]) {
    await shell.user.clear(field());
    await shell.user.type(field(), `${total}{Enter}`);
    await screen.findByText("This amount couldn’t be saved. Try again.");
    await waitFor(() => expect(field()).toHaveProperty("readOnly", false));
  }
  await shell.user.keyboard("{Escape}");
  const group = screen.getByRole("button", { name: /^Everyday/ });
  await shell.user.click(group);
  expect(
    screen.queryByRole("button", { name: /assigned to Gifts/ }),
  ).toBeNull();
  await shell.user.click(group);
  shell.execute.mockReturnValue({ revision: 6 });
  shell.read.mockReturnValue(stateFixture({ assigned: 15_000, revision: 6 }));
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150{Enter}");
  await screen.findByRole("button", {
    name: "$150.00 assigned to Gifts. Edit assigned amount",
  });
  const requests = shell.execute.mock.calls.map(([input]) => input);
  expect(requests).toHaveLength(3);
  expect(requests[2]).toEqual(requests[0]);
  expect(requests[1]!.command.id).not.toBe(requests[0]!.command.id);
  expect(requests[0]!.command).toMatchObject({
    type: "assign",
    month: "2026-10",
    amount: 5_000,
  });
});

test("an incoming assignment requires confirmation before replacing the unseen total", async () => {
  const shell = await renderShell();
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150");
  shell.read.mockReturnValue(stateFixture({ assigned: 13_000, revision: 6 }));
  await act(() => shell.queryClient.invalidateQueries());
  await shell.user.keyboard("{Enter}");
  expect(screen.getByRole("alert").textContent).toContain(
    "Assigned changed to $130.00 while you were editing",
  );
  expect(shell.execute).not.toHaveBeenCalled();
  await shell.user.keyboard("{Enter}");
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(shell.execute.mock.calls[0]![0]).toMatchObject({
    expectedRevision: 6,
    command: { amount: 2_000, month: "2026-10" },
  });
});

test("Enter followed by blur cannot submit an assignment twice", async () => {
  const pending = deferred<{ revision: number }>();
  const shell = await renderShell({ execute: () => pending.promise });
  await shell.user.click(amount());
  await shell.user.clear(field());
  await shell.user.type(field(), "150{Enter}");
  await waitFor(() => expect(shell.execute).toHaveBeenCalledTimes(1));
  expect(field()).toHaveProperty("readOnly", true);
  fireEvent.blur(field());
  fireEvent.submit(field().closest("form")!);
  await shell.user.keyboard("{Escape}");
  expect(field()).toHaveProperty("value", "150");
  expect(shell.execute).toHaveBeenCalledTimes(1);
  shell.read.mockReturnValue(stateFixture({ assigned: 15_000, revision: 6 }));
  pending.resolve({ revision: 6 });
  await screen.findByRole("button", {
    name: "$150.00 assigned to Gifts. Edit assigned amount",
  });
});

test("changing month discards an unsaved assignment instead of applying it to the new month", async () => {
  const shell = await renderShell({ read: (month) => stateFixture({ month }) });
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
  expect(shell.execute).not.toHaveBeenCalled();
});
