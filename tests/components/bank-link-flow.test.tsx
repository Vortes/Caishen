import { act, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { PlaidSdk } from "~/components/banks/plaid-link-sdk";
import type { State } from "~/components/budget/types";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import {
  deferred,
  findToast,
  readyOverview,
  renderShell,
} from "./shell-harness";
import type { FakeServer } from "./sync/fake-server";

// Connecting a bank, step by step, as the member sees it: Plaid's window,
// then the shell's one dialog or a toast for each way the flow ends.

type Connection = State["connections"][number];
type PlaidOptions = Parameters<PlaidSdk["create"]>[0];
type Answer<T> = T | Promise<T>;

const metadata = {
  institution: { institution_id: "ins-chase" },
  accounts: [
    {
      id: "provider-checking",
      name: "Chase checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
    },
  ],
};

// Chase with its checking account already in the budget, so a finished
// connection has nothing left to add.
function chase(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "chase",
    itemId: "chase-item",
    institutionId: "ins-chase",
    institutionName: "Chase",
    error: null,
    lastSyncedAt: new Date("2026-10-20T12:00:00Z"),
    lastAttemptAt: new Date("2026-10-20T12:00:00Z"),
    status: "connected",
    consentExpiresAt: null,
    lastSuccessfulUpdateAt: new Date("2026-10-20T12:00:00Z"),
    lastFailedUpdateAt: null,
    newAccountsAvailable: false,
    transactionStatus: "HISTORICAL_UPDATE_COMPLETE",
    synchronizedAccountIds: ["provider-checking"],
    accountMappings: {
      "provider-checking": { accountId: "checking", startDate: "2026-10-01" },
    },
    accounts: [
      {
        accountId: "provider-checking",
        name: "Chase checking",
        officialName: null,
        mask: "1234",
        type: "depository",
        subtype: "checking",
        currentBalance: 1000,
        availableBalance: 1000,
        currency: "USD",
      },
    ],
    ...overrides,
  };
}

const synced = (server: FakeServer) => ({
  imported: 0,
  updated: 0,
  revision: server.revision,
  changeSet: null,
  rebased: false as const,
});

/**
 * The shell with Plaid configured, `existing` banks (Chase by default), and
 * the Banks popover open. Plaid's window finishes as `plaid` says, by default
 * with the member sharing Chase's checking account, which the exchange saves
 * to the Chase connection already in the budget's state.
 */
async function openBanks(
  options: {
    existing?: Connection[];
    plaid?: (link: PlaidOptions) => void;
    token?: () => Answer<RouterOutputs["budget"]["plaidLinkToken"]>;
    exchange?: () => Answer<RouterOutputs["budget"]["plaidExchange"]>;
    reconnect?: (
      input: RouterInputs["budget"]["plaidReconnect"],
    ) => Answer<RouterOutputs["budget"]["plaidReconnect"]>;
    sync?: (server: FakeServer) => Answer<RouterOutputs["budget"]["sync"]>;
  } = {},
) {
  const connections = options.existing ?? [chase()];
  const finish =
    options.plaid ??
    ((link: PlaidOptions) => link.onSuccess("public-token", metadata));
  const create = vi.fn<PlaidSdk["create"]>((link) => ({
    open: () => finish(link),
    destroy: () => undefined,
  }));
  vi.stubGlobal("Plaid", { create });
  const token = vi.fn(
    options.token ??
      (() => ({
        linkToken: "link-token",
        expiration: "2026-10-21T00:00:00Z",
      })),
  );
  const exchange = vi.fn(options.exchange ?? (() => ({ id: "chase" })));
  const sync = vi.fn(options.sync ?? synced);
  const shell = await renderShell({
    overview: () =>
      readyOverview({
        connections,
        services: [{ name: "Plaid", status: "configured", detail: "Ready" }],
      }),
    bankLink: {
      token,
      review: () => ({
        verdict: "none",
        reviewId: "a".repeat(64),
        mayDisconnectExisting: false,
        connections: [],
      }),
      exchange,
      reconnect: options.reconnect,
    },
    sync,
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  return { ...shell, create, token, exchange, sync };
}

async function connectBank(shell: Awaited<ReturnType<typeof openBanks>>) {
  await shell.user.click(
    screen.getByRole("button", { name: "Connect a bank" }),
  );
}

const refuse = (message: string) => () => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

test("a bank connection that can't start says why in a toast", async () => {
  const shell = await openBanks({
    token: refuse("Bank connections are paused for maintenance."),
  });
  await connectBank(shell);
  const toast = await findToast("Bank connections are paused for maintenance.");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(shell.create).not.toHaveBeenCalled();
});

test("leaving Plaid with a bank error says why in a toast", async () => {
  const shell = await openBanks({
    plaid: (link) =>
      link.onExit(
        { error_code: "INSTITUTION_DOWN", display_message: "Chase is down." },
        {},
      ),
  });
  await connectBank(shell);
  const toast = await findToast("Chase is down.");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(shell.exchange).not.toHaveBeenCalled();
});

test("a bank connection started away from Caishen's bank address offers that address instead of a toast", async () => {
  const shell = await openBanks({
    token: () => ({
      linkToken: "link-token",
      expiration: "2026-10-21T00:00:00Z",
      redirectUri: "https://banks.caishen.example/plaid/oauth-return",
    }),
  });
  await connectBank(shell);
  const dialog = await screen.findByRole("dialog", {
    name: "Connect from banks.caishen.example",
  });
  expect(
    within(dialog)
      .getByRole("link", { name: "Open banks.caishen.example" })
      .getAttribute("href"),
  ).toBe("https://banks.caishen.example");
  expect(shell.create).not.toHaveBeenCalled();
  const notifications = screen.getByRole("region", { name: "Notifications" });
  expect(
    within(notifications).queryByText(/bank connection address/),
  ).toBeNull();
  await shell.user.click(
    within(dialog).getByRole("button", { name: "Cancel" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a new bank shows saving, then bringing in activity, then says it connected by name", async () => {
  const saving = deferred<void>();
  const syncing = deferred<void>();
  const shell = await openBanks({
    exchange: async () => {
      await saving.promise;
      return { id: "chase" };
    },
    sync: async (server) => {
      await syncing.promise;
      return synced(server);
    },
  });
  await connectBank(shell);
  const dialog = await screen.findByRole("dialog", {
    name: "Connecting your bank",
  });
  expect(within(dialog).getByRole("status").textContent).toBe(
    "Saving your connection…",
  );
  saving.resolve();
  await waitFor(() =>
    expect(within(dialog).getByRole("status").textContent).toMatch(
      /^Bringing in your accounts/,
    ),
  );
  syncing.resolve();
  await findToast("Connected Chase");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a connected bank with accounts to add opens their setup", async () => {
  const shell = await openBanks({ existing: [chase({ accountMappings: {} })] });
  await connectBank(shell);
  await screen.findByRole("dialog", { name: "Add Chase to your budget" });
  expect(shell.sync).toHaveBeenCalledOnce();
});

test("a connected bank that reports an error shows that error", async () => {
  const shell = await openBanks({
    existing: [chase({ error: "Chase needs you to sign in again." })],
  });
  await connectBank(shell);
  const toast = await findToast("Chase needs you to sign in again.");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("reconnecting a bank says it reconnected", async () => {
  const reconnect = vi.fn(() => ({ id: "chase" }));
  const shell = await openBanks({
    existing: [chase({ status: "login_required" })],
    reconnect,
  });
  await shell.user.click(screen.getByRole("button", { name: "Reconnect" }));
  await findToast("Reconnected Chase");
  expect(shell.token).toHaveBeenCalledWith({ connectionId: "chase" });
  expect(reconnect).toHaveBeenCalledWith({ connectionId: "chase", metadata });
  expect(shell.exchange).not.toHaveBeenCalled();
});

test("a bank connection that can't be saved says why in a toast", async () => {
  const shell = await openBanks({
    exchange: refuse("Chase could not be saved."),
  });
  await connectBank(shell);
  const toast = await findToast("Chase could not be saved.");
  expect(toast.getAttribute("role")).toBe("alert");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(shell.sync).not.toHaveBeenCalled();
});

test("a reconnect the server refuses still reports the connection as saved", async () => {
  const shell = await openBanks({
    existing: [chase({ status: "login_required" })],
    reconnect: refuse("Chase is still signing you in."),
  });
  await shell.user.click(screen.getByRole("button", { name: "Reconnect" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Your bank is connected",
  });
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Your bank connection is saved, but its activity isn’t available yet. Chase is still signing you in.",
  );
  expect(shell.sync).not.toHaveBeenCalled();
});

// The automatic retry after a sync failure waits 30 seconds of the page's
// clock; the clock still runs, so everything else proceeds as usual.
function fakeClock() {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date"],
    shouldAdvanceTime: true,
  });
  vi.setSystemTime(new Date("2026-10-20T19:00:00Z"));
}

// Fails a sync with each message in turn, then succeeds.
function failingSync(...messages: string[]) {
  let calls = 0;
  return (server: FakeServer) => {
    const message = messages[calls++];
    if (message) throw new TRPCError({ code: "BAD_REQUEST", message });
    return synced(server);
  };
}

test("a saved bank whose activity isn't ready says so, retries on its own, and then says it connected", async () => {
  fakeClock();
  const shell = await openBanks({
    sync: failingSync("Chase is still preparing your accounts."),
  });
  await connectBank(shell);
  const dialog = await screen.findByRole("dialog", {
    name: "Your bank is connected",
  });
  expect(within(dialog).getByRole("alert").textContent).toBe(
    "Your bank connection is saved, but its activity isn’t available yet. Chase is still preparing your accounts.",
  );
  expect(shell.sync).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  await findToast("Connected Chase");
  expect(shell.sync).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("a retry that fails again shows the new reason and keeps the bank connected", async () => {
  fakeClock();
  const shell = await openBanks({
    sync: failingSync(
      "Chase is still preparing your accounts.",
      "Chase needs a few more minutes.",
    ),
  });
  await connectBank(shell);
  await screen.findByRole("dialog", { name: "Your bank is connected" });
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("dialog", { name: "Your bank is connected" }),
      ).getByRole("alert").textContent,
    ).toBe("Chase needs a few more minutes."),
  );
  expect(shell.sync).toHaveBeenCalledTimes(2);
});

test("choosing Later on a saved bank whose activity isn't ready closes it and stops the retry", async () => {
  fakeClock();
  const shell = await openBanks({
    sync: failingSync("Chase is still preparing your accounts."),
  });
  await connectBank(shell);
  const dialog = await screen.findByRole("dialog", {
    name: "Your bank is connected",
  });
  await shell.user.click(within(dialog).getByRole("button", { name: "Later" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(shell.sync).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
