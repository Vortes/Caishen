import { screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { RouterInputs, RouterOutputs } from "~/trpc/react";
import type { PlaidSdk } from "~/components/banks/plaid-link-sdk";
import { readyOverview, renderShell } from "./shell-harness";

type Review = RouterOutputs["budget"]["plaidLinkReview"];
const metadata = {
  institution: { institution_id: "ins-chase" },
  accounts: [
    {
      id: "new-checking",
      name: "Checking",
      mask: "1234",
      type: "depository",
      subtype: "checking",
    },
  ],
};
function review(verdict: Review["verdict"]): Review {
  return {
    verdict,
    reviewId: "a".repeat(64),
    mayDisconnectExisting: true,
    connections: [
      {
        id: "chase-existing",
        institutionName: "Chase",
        accounts: [
          {
            accountId: "old-checking",
            name: "Everyday Checking",
            mask: "1234",
          },
        ],
      },
    ],
  };
}
async function linked(
  verdict: Review["verdict"],
  options: { review?: () => Review; exchange?: () => { id: string } } = {},
) {
  const create = vi.fn<PlaidSdk["create"]>((options) => ({
    open: () => {
      if (options.token === "link-new")
        options.onSuccess("held-public-token", metadata);
    },
    destroy: () => undefined,
  }));
  vi.stubGlobal("Plaid", { create });
  const token = vi.fn((input: RouterInputs["budget"]["plaidLinkToken"]) => ({
    linkToken: input?.connectionId ? "link-existing" : "link-new",
    expiration: "2026-10-21T00:00:00Z",
  }));
  const check = vi.fn(options.review ?? (() => review(verdict)));
  const exchange = vi.fn(options.exchange ?? (() => ({ id: "second-bank" })));
  const shell = await renderShell({
    overview: () =>
      readyOverview({
        services: [{ name: "Plaid", status: "configured", detail: "Ready" }],
      }),
    bankLink: { token, review: check, exchange },
  });
  await shell.user.click(screen.getByRole("button", { name: "Banks" }));
  await shell.user.click(
    screen.getByRole("button", { name: "Connect a bank" }),
  );
  return { ...shell, token, check, exchange, create };
}

test("all-connected Link shows masked accounts and only Close without exchanging the token", async () => {
  const shell = await linked("all");
  const dialog = await screen.findByRole("dialog", {
    name: "These accounts are already connected",
  });
  expect(within(dialog).getByText("Everyday Checking")).toBeTruthy();
  expect(within(dialog).getByText(/1234/)).toBeTruthy();
  expect(
    within(dialog)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Close"]);
  expect(shell.exchange).not.toHaveBeenCalled();
  expect(shell.check).toHaveBeenCalledWith({ metadata });
  await shell.user.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", {
        name: "These accounts are already connected",
      }),
    ).toBeNull(),
  );
  expect(shell.exchange).not.toHaveBeenCalled();
});

test("partial duplicate review offers shared-account recovery first and exchanges only on Connect anyway", async () => {
  const shell = await linked("some");
  const dialog = await screen.findByRole("dialog", {
    name: "You already connected this bank",
  });
  expect(
    within(dialog).getByRole("button", { name: "Choose shared accounts" }),
  ).toBeTruthy();
  expect(within(dialog).getByText(/second login.*stop updates/i)).toBeTruthy();
  expect(shell.exchange).not.toHaveBeenCalled();
  await shell.user.click(
    within(dialog).getByRole("button", { name: "Connect anyway" }),
  );
  await waitFor(() =>
    expect(shell.exchange).toHaveBeenCalledWith({
      publicToken: "held-public-token",
      metadata,
      reviewId: "a".repeat(64),
    }),
  );
});

test("unknown matches explain missing details, trap keyboard focus, and open the existing bank from a touch action", async () => {
  const shell = await linked("unknown");
  const dialog = await screen.findByRole("dialog", {
    name: "You already connected this bank",
  });
  expect(
    within(dialog).getByText(/names or last digits are missing/i),
  ).toBeTruthy();
  for (let step = 0; step < 6; step++) {
    await shell.user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  const recover = within(dialog).getByRole("button", {
    name: "Choose shared accounts",
  });
  await shell.user.pointer([
    { keys: "[TouchA>]", target: recover },
    { keys: "[/TouchA]", target: recover },
  ]);
  await waitFor(() =>
    expect(shell.token).toHaveBeenCalledWith({
      connectionId: "chase-existing",
    }),
  );
  expect(shell.exchange).not.toHaveBeenCalled();
});

test("a changed connection is reviewed again and an all-connected result removes Connect anyway", async () => {
  let calls = 0;
  const shell = await linked("some", {
    review: () => review(calls++ === 0 ? "some" : "all"),
    exchange: () => {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Your bank accounts changed. Review the connection again before continuing.",
      });
    },
  });
  const first = await screen.findByRole("dialog", {
    name: "You already connected this bank",
  });
  await shell.user.click(
    within(first).getByRole("button", { name: "Connect anyway" }),
  );
  const refreshed = await screen.findByRole("dialog", {
    name: "These accounts are already connected",
  });
  expect(
    within(refreshed).queryByRole("button", { name: "Connect anyway" }),
  ).toBeNull();
  expect(within(refreshed).getByRole("alert").textContent).toMatch(
    /bank accounts changed/i,
  );
  expect(shell.exchange).toHaveBeenCalledTimes(1);
});

test("a separate login at the same bank explains that the selected accounts look different and allows continuing", async () => {
  const shell = await linked("none");
  const dialog = await screen.findByRole("dialog", {
    name: "You already connected this bank",
  });
  expect(
    within(dialog).getByText(/selected accounts look different/i),
  ).toBeTruthy();
  expect(
    within(dialog).getByRole("button", { name: "Choose shared accounts" }),
  ).toBeTruthy();
  await shell.user.click(
    within(dialog).getByRole("button", { name: "Connect anyway" }),
  );
  await waitFor(() => expect(shell.exchange).toHaveBeenCalledTimes(1));
});

test("a removed existing connection is explained before retrying a held Link token", async () => {
  let calls = 0;
  const shell = await linked("some", {
    review: () =>
      calls++ === 0
        ? review("some")
        : { ...review("none"), connections: [], mayDisconnectExisting: false },
    exchange: () => {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "Your bank accounts changed. Review the connection again before continuing.",
      });
    },
  });
  const first = await screen.findByRole("dialog", {
    name: "You already connected this bank",
  });
  await shell.user.click(
    within(first).getByRole("button", { name: "Connect anyway" }),
  );
  const refreshed = await screen.findByRole("dialog", {
    name: "Review your bank connection",
  });
  expect(
    within(refreshed).getByText(/previous connection is no longer active/i),
  ).toBeTruthy();
  expect(
    within(refreshed).queryByRole("button", { name: "Choose shared accounts" }),
  ).toBeNull();
  expect(
    within(refreshed).getByRole("button", { name: "Connect anyway" }),
  ).toBeTruthy();
  expect(shell.exchange).toHaveBeenCalledTimes(1);
});
