"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlertIcon, CircleCheckIcon, LogInIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { currentMonth } from "~/components/budget/format";
import { api } from "~/trpc/react";
import {
  BankConnectionsProvider,
  BankDialog,
  useBankConnections,
} from "~/components/app-shell/banks";
import { EmptyAppFrame } from "~/components/entry/empty-app-frame";
import { SHELL_PATH } from "~/components/workspace/routes";
import shell from "~/components/app-shell/shell.module.css";

const holdOpen = () => () => undefined;

export function PlaidOAuthReturn() {
  const { isLoaded, userId } = useAuth();
  const [month, setMonth] = useState(currentMonth);
  const [returnUrl, setReturnUrl] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const utils = api.useUtils();
  const budget = api.budget.state.useQuery(
    { month },
    { enabled: Boolean(userId) },
  );
  const timezone = budget.data?.view?.budget.settings.timezone;
  useEffect(() => {
    if (timezone) setMonth(currentMonth(timezone));
  }, [timezone]);
  useEffect(() => setReturnUrl(window.location.href), []);
  const banks = useBankConnections({
    state: budget.data ?? {
      connections: [],
      view: null,
      services: [],
    },
    notify: setNotice,
    holdOpen,
    resumeReturn: true,
    runOnServer: async (_id, send) => {
      const current = await utils.client.budget.state.query({ month });
      await send(current.revision);
      await utils.budget.state.invalidate();
    },
  });
  const back =
    userId &&
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(`caishen:onboarding:${userId}`)
      ? "/welcome"
      : SHELL_PATH;
  const Icon = !userId
    ? LogInIcon
    : banks.saved
      ? CircleCheckIcon
      : CircleAlertIcon;
  return (
    <EmptyAppFrame>
      <BankConnectionsProvider value={banks}>
        {!banks.view && !banks.plaidOpen && (
          <div className={shell.empty} role="status">
            <Icon size={18} aria-hidden />
            <div className={shell.emptyBody}>
              <p>
                <strong>
                  {!isLoaded
                    ? "Opening your bank connection…"
                    : !userId
                      ? "Finish connecting your bank"
                      : banks.saved
                        ? "Your bank is connected"
                        : banks.error
                          ? "Your bank connection needs attention"
                          : "Opening your bank connection…"}
                </strong>
                {!userId && isLoaded
                  ? "Sign in to the same Caishen account you used to start connecting your bank."
                  : banks.error || notice}
              </p>
              {!userId && isLoaded && returnUrl ? (
                <SignInButton mode="redirect" forceRedirectUrl={returnUrl}>
                  <Button variant="primary">
                    Sign in to finish connecting
                  </Button>
                </SignInButton>
              ) : (
                userId && (
                  <>
                    {budget.error && (
                      <>
                        <p role="alert">{budget.error.message}</p>
                        <Button onClick={() => void budget.refetch()}>
                          Retry loading accounts
                        </Button>
                      </>
                    )}
                    {banks.connections.map((connection) => (
                      <div key={connection.id}>
                        <Button onClick={() => banks.setUp(connection.id)}>
                          Set up {connection.institutionName ?? "bank"} accounts
                        </Button>
                      </div>
                    ))}
                    {(banks.error || banks.saved) && (
                      <Button asChild>
                        <Link href={back}>Back to your budget</Link>
                      </Button>
                    )}
                  </>
                )
              )}
            </div>
          </div>
        )}
        <BankDialog />
      </BankConnectionsProvider>
    </EmptyAppFrame>
  );
}
