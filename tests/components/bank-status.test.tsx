import { screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { State } from "~/components/budget/types";
import { readyOverview, renderShell } from "./shell-harness";

// The Banks panel shows what Plaid reported about a connection, from its
// stored status, with the action that fixes it.

const today = new Date("2026-10-25T12:00:00Z");
afterEach(() => vi.restoreAllMocks());

test("a revoked account keeps its budget row and offers re-sharing without a stale bank balance", async () => {
  const bank = {
    ...chase({}),
    unavailableAccountIds: ["provider-checking"],
    revokedAccountIds: ["provider-checking"],
  };
  const shell = await renderShell({
    overview: () =>
      readyOverview({
        connections: [bank],
        services: [{ name: "Plaid", status: "configured", detail: "Ready" }],
      }),
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  const banks = screen.getByRole("dialog", { name: "Connected banks" });
  expect(within(banks).getByText("Access revoked at the bank")).toBeTruthy();
  expect(within(banks).queryByText("$1,000.00")).toBeNull();
  expect(
    within(banks).getByRole("button", { name: "Choose shared accounts" }),
  ).toBeTruthy();
  expect(
    within(
      screen.getByRole("navigation", { name: "Budget navigation" }),
    ).getByRole("link", { name: "Checking $1,000.00" }),
  ).toBeTruthy();
  expect(shell.execute).not.toHaveBeenCalled();
});

function chase(
  health: Partial<
    Pick<
      State["connections"][number],
      "status" | "consentExpiresAt" | "newAccountsAvailable"
    >
  >,
): State["connections"][number] {
  return {
    id: "chase",
    itemId: "chase-item",
    institutionId: "ins_3",
    institutionName: "Chase",
    error: null,
    lastSyncedAt: new Date("2026-10-24T12:00:00Z"),
    lastAttemptAt: new Date("2026-10-24T12:00:00Z"),
    status: "connected",
    consentExpiresAt: null,
    lastSuccessfulUpdateAt: new Date("2026-10-24T12:00:00Z"),
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
    ...health,
  };
}

test.each([
  [chase({ status: "login_required" }), "Sign in again", "Reconnect"],
  [
    chase({ status: "pending_disconnect" }),
    "Disconnects in 7 days",
    "Reconnect",
  ],
  [
    chase({
      status: "pending_disconnect",
      consentExpiresAt: new Date("2026-10-30T12:00:00Z"),
    }),
    "Consent expires on Oct 30",
    "Reconnect",
  ],
  [
    chase({ newAccountsAvailable: true }),
    "New accounts available",
    "Choose shared accounts",
  ],
  [chase({ status: "revoked" }), "Access revoked", "Link again"],
])(
  "the Banks panel shows %o as “%s” with the action “%s”",
  async (connection, label, action) => {
    vi.spyOn(Date, "now").mockReturnValue(today.getTime());
    const shell = await renderShell({
      overview: () =>
        readyOverview({
          connections: [connection],
          services: [{ name: "Plaid", status: "configured", detail: "Ready" }],
        }),
    });
    await shell.user.click(screen.getByRole("button", { name: "Banks" }));
    const banks = screen.getByRole("dialog", { name: "Connected banks" });
    expect(within(banks).getByText(label)).toBeTruthy();
    expect(within(banks).getByRole("button", { name: action })).toBeTruthy();
  },
);
