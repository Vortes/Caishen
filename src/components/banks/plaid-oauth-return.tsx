"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand, Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";
import { usePlaidLink } from "./use-plaid-link";
import { currentMonth } from "~/components/budget/format";
import { api } from "~/trpc/react";
import {
  BankAccountSetup,
  hasUnmappedBankAccounts,
  useBankAccountSetup,
} from "./bank-account-setup";

export function PlaidOAuthReturn() {
  const link = usePlaidLink();
  const { isLoaded, userId, resume, cancel } = link;
  const [returnUrl, setReturnUrl] = useState("");
  const [month, setMonth] = useState(currentMonth);
  const budget = api.budget.state.useQuery(
    { month },
    { enabled: Boolean(userId && link.saved && !link.busy) },
  );
  const setup = useBankAccountSetup(
    budget.data ?? undefined,
    link.connectionId,
    link.saved && !link.busy,
  );
  const savedConnection = budget.data?.connections.find(
    (connection) => connection.id === link.connectionId,
  );

  useEffect(() => {
    const timezone = budget.data?.view?.budget.settings.timezone;
    if (timezone) setMonth(currentMonth(timezone));
  }, [budget.data?.view?.budget.settings.timezone]);

  useEffect(() => setReturnUrl(window.location.href), []);
  useEffect(() => {
    if (!isLoaded || !userId) return;
    void resume();
    return cancel;
  }, [isLoaded, userId, resume, cancel]);

  const title = link.saved
    ? "Your bank is connected."
    : link.error
      ? "Your bank connection needs attention."
      : "Finish connecting your bank.";

  return (
    <main className="onboarding">
      <Brand />
      <section className="panel w-full max-w-xl">
        <div className="panel-header">
          <h1 className="text-xl">{title}</h1>
        </div>
        <div className="panel-body grid gap-5">
          {!isLoaded || !returnUrl ? (
            <p role="status">Opening your bank connection…</p>
          ) : !userId ? (
            <>
              <p>
                Sign in to the same Caishen account you used to start connecting
                your bank.
              </p>
              <SignInButton mode="redirect" forceRedirectUrl={returnUrl}>
                <Button>
                  Sign in to finish connecting <Icon name="arrow" size={16} />
                </Button>
              </SignInButton>
            </>
          ) : (
            <>
              {link.error && (
                <p className="form-error" role="alert">
                  {link.error}
                </p>
              )}
              {link.message && <p role="status">{link.message}</p>}
              {link.busy && (
                <p role="status">
                  {link.phase === "saving"
                    ? "Saving your bank connection…"
                    : link.phase === "syncing"
                      ? "Updating your bank accounts and activity…"
                      : "Continue in the secure Plaid window to finish connecting your bank."}
                </p>
              )}
              {link.needsSync && (
                <Button
                  disabled={link.busy}
                  onClick={() => void link.retrySync()}
                >
                  {link.busy ? "Updating…" : "Retry bank update"}
                </Button>
              )}
              {link.saved && !link.busy && budget.isPending && (
                <p>Loading your connected accounts…</p>
              )}
              {budget.error && (
                <div className="grid gap-3">
                  <p className="form-error" role="alert">
                    {budget.error.message}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => void budget.refetch()}
                  >
                    Retry loading accounts
                  </Button>
                </div>
              )}
              {savedConnection && hasUnmappedBankAccounts(savedConnection) && (
                <Button onClick={() => setup.open(savedConnection.id)}>
                  Set up accounts
                </Button>
              )}
              <Button
                asChild
                variant={
                  link.saved &&
                  !(savedConnection && hasUnmappedBankAccounts(savedConnection))
                    ? "default"
                    : "secondary"
                }
              >
                <Link href="/">
                  Back to your budget <Icon name="arrow" size={16} />
                </Link>
              </Button>
            </>
          )}
        </div>
      </section>
      {setup.connection && budget.data && (
        <BankAccountSetup
          key={setup.connection.id}
          state={budget.data}
          connection={setup.connection}
          onClose={setup.close}
        />
      )}
    </main>
  );
}
