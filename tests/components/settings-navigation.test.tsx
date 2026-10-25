import { act, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderShell, transactionRow } from "./shell-harness";

test("register filter URLs survive reload and browser history without rereading the budget during navigation", async () => {
  let pulls = 0;
  const shell = await renderShell({
    pull: (input, server) => {
      pulls++;
      return server.pull("owner", input);
    },
    seedCommands: [
      {
        type: "transaction.upsert",
        id: "coffee",
        transactionId: "coffee",
        accountId: "checking",
        categoryId: "gifts",
        date: "2026-10-10",
        payee: "Coffee",
        amount: -500,
        status: "posted",
        reviewed: false,
      },
      {
        type: "transaction.upsert",
        id: "market",
        transactionId: "market",
        accountId: "checking",
        categoryId: "gifts",
        date: "2026-10-10",
        payee: "Market",
        amount: -2500,
        status: "posted",
        reviewed: true,
      },
    ],
  });
  await shell.user.click(screen.getByRole("link", { name: /^Checking/ }));
  await waitFor(() => expect(shell.overview).toHaveBeenCalled());
  const loadedPulls = pulls;
  const loadedOverviews = shell.overview.mock.calls.length;
  await shell.user.click(screen.getByRole("button", { name: /To review/ }));
  expect(new URLSearchParams(window.location.search).get("view")).toBe(
    "review",
  );
  await shell.user.type(
    screen.getByRole("searchbox", { name: "Search Checking" }),
    "Coffee",
  );
  expect(new URLSearchParams(window.location.search).get("q")).toBe("Coffee");
  expect(transactionRow("Coffee")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Select Market" })).toBeNull();
  expect(pulls).toBe(loadedPulls);
  expect(shell.overview.mock.calls.length).toBe(loadedOverviews);

  await act(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await changed;
  });
  expect(
    screen.getByRole("searchbox", { name: "Search Checking" }),
  ).toHaveProperty("value", "");
  expect(transactionRow("Market")).toBeTruthy();
  await act(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await changed;
  });
  expect(
    screen.getByRole("searchbox", { name: "Search Checking" }),
  ).toHaveProperty("value", "Coffee");
  await shell.reload();
  expect(
    screen.getByRole("searchbox", { name: "Search Checking" }),
  ).toHaveProperty("value", "Coffee");
  expect(
    screen
      .getByRole("button", { name: /To review/ })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(transactionRow("Coffee")).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "Select Market" })).toBeNull();
  await shell.user.click(
    screen.getByRole("button", { name: "Component budget" }),
  );
  await shell.user.click(screen.getByRole("menuitem", { name: "Settings" }));
  await shell.user.click(screen.getByRole("link", { name: "Back to app" }));
  expect(
    screen.getByRole("searchbox", { name: "Search Checking" }),
  ).toHaveProperty("value", "Coffee");
  await shell.user.click(screen.getByRole("link", { name: "Plan" }));
  expect(new URLSearchParams(window.location.search).has("q")).toBe(false);
  expect(new URLSearchParams(window.location.search).has("view")).toBe(false);
});

test("opening an account address restores its register", async () => {
  window.history.replaceState(null, "", "/app/accounts/checking?month=2026-10");
  await renderShell({ plan: false });
  await screen.findByRole("heading", { name: "Checking" });
  expect(
    screen.getByRole("link", { name: /^Checking/, current: "page" }),
  ).toBeTruthy();
});

test("sidebar addresses survive reloading and browser history keeps the selected screen and month", async () => {
  const shell = await renderShell({
    plan: false,
    seedCommands: [
      {
        type: "loan.add",
        id: "add-loan",
        loanId: "student",
        categoryId: "student-payment",
        name: "Student loan",
        principal: 100_000,
        annualRateBps: 500,
        minimumPayment: 5_000,
        variable: false,
        effectiveDate: "2026-10-01",
      },
    ],
  });
  await screen.findByRole("heading", { name: "Plan" });
  await shell.user.click(screen.getByRole("button", { name: "Next month" }));
  for (const [name, pathname, title] of [
    ["All accounts", "/app/accounts", "All accounts"],
    [/^Checking/, "/app/accounts/checking", "Checking"],
    ["Loans", "/app/loans", "Loans"],
    [/^Student loan/, "/app/loans/student", "Loans"],
    ["Reflect", "/app/reflect", "Reflect"],
    ["Plan", "/app", "Plan"],
  ] as const) {
    await shell.user.click(screen.getByRole("link", { name }));
    expect(window.location.pathname).toBe(pathname);
    expect(new URLSearchParams(window.location.search).get("month")).toBe(
      "2026-11",
    );
    await screen.findByRole("heading", { name: title, level: 1 });
    await shell.reload();
    await screen.findByRole("heading", { name: title, level: 1 });
    expect(screen.getByRole("link", { name, current: "page" })).toBeTruthy();
    if (title !== "Reflect")
      expect(
        screen.getByRole("button", { name: /November 2026, choose a month/ }),
      ).toBeTruthy();
    if (pathname === "/app/loans/student") {
      await shell.user.keyboard("{Escape}");
      expect(window.location.pathname).toBe("/app/loans");
      expect(
        screen.getByRole("link", { name: "Loans", current: "page" }),
      ).toBeTruthy();
      await shell.user.click(
        screen.getByRole("link", { name: /^Student loan/ }),
      );
    }
  }
  await act(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await changed;
  });
  await screen.findByRole("heading", { name: "Reflect" });
  await act(async () => {
    const changed = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await changed;
  });
  await screen.findByRole("heading", { name: "Plan" });
});

test("settings opens Profile and Partner at their app addresses and returns to the same budget", async () => {
  const { user } = await renderShell();
  await user.click(screen.getByRole("button", { name: "Component budget" }));
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  expect(window.location.pathname).toBe("/app/settings");
  await screen.findByRole("heading", { name: "Profile" });
  expect(screen.getByLabelText("Budget name")).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "Partner" }));
  expect(window.location.pathname).toBe("/app/settings/partner");
  await screen.findByRole("heading", { name: "Partner" });
  expect(screen.getByRole("button", { name: "Create code" })).toBeTruthy();

  await user.click(screen.getByRole("link", { name: "Back to app" }));
  expect(window.location.pathname).toBe("/app");
  await screen.findByRole("heading", { name: "Plan" });
});

test("settings keeps the return screen and month when reloaded", async () => {
  window.history.replaceState(null, "", "/app/accounts/checking?month=2026-11");
  const shell = await renderShell({ plan: false });
  await screen.findByRole("heading", { name: "Checking" });
  await shell.user.click(
    screen.getByRole("button", { name: "Component budget" }),
  );
  await shell.user.click(screen.getByRole("menuitem", { name: "Settings" }));
  await shell.user.click(screen.getByRole("link", { name: "Appearance" }));
  await shell.reload();
  await screen.findByRole("heading", { name: "Appearance" });
  const back = screen.getByRole("link", { name: "Back to app" });
  expect(back.getAttribute("href")).toBe(
    "/app/accounts/checking?month=2026-11",
  );
  await shell.user.click(back);
  await screen.findByRole("heading", { name: "Checking" });
  expect(
    screen.getByRole("button", { name: /November 2026, choose a month/ }),
  ).toBeTruthy();
});
