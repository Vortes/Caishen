"use client";

import { Button } from "~/components/ui/button";
import { type State } from "~/components/budget/types";
import { Icon } from "~/components/shared";
import { usePlaidLink } from "./use-plaid-link";
import {
  BankAccountSetup,
  bankAccountMappings,
  hasUnmappedBankAccounts,
  useBankAccountSetup,
} from "./bank-account-setup";

function balance(value: number | null, currency: string | null) {
  if (value === null) return "Unavailable";
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    value,
  );
}

export function BankConnections({ state }: { state: State }) {
  const link = usePlaidLink();
  const setup = useBankAccountSetup(
    state,
    link.saved ? link.connectionId : undefined,
    !link.busy,
  );
  const available =
    state.services.find((service) => service.name === "Plaid")?.status ===
    "configured";
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Bank connections</h2>
          <p>
            Securely connect Chase, American Express, and other banks through
            Plaid.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={!available || !link.userId || link.busy}
          onClick={() => void link.start()}
        >
          {link.busy && !link.connectionId ? "Connecting…" : "Connect a bank"}
          <Icon name="arrow" size={14} />
        </Button>
      </div>
      <div className="panel-body">
        {link.error && (
          <p className="form-error" role="alert">
            {link.error}
          </p>
        )}
        {link.canonicalOrigin && (
          <Button asChild variant="secondary">
            <a href={link.canonicalOrigin}>
              Open {new URL(link.canonicalOrigin).host}
              <Icon name="arrow" size={14} />
            </a>
          </Button>
        )}
        {link.message && (
          <p className="notice" role="status">
            {link.message}
          </p>
        )}
        {link.phase === "saving" && (
          <p role="status">Saving your bank connection…</p>
        )}
        {link.phase === "syncing" && (
          <p role="status">Updating your bank accounts and activity…</p>
        )}
        {link.needsSync && (
          <Button
            variant="secondary"
            disabled={link.busy}
            onClick={() => void link.retrySync()}
          >
            {link.busy ? "Updating…" : "Retry bank update"}
          </Button>
        )}
        {state.connections.length ? (
          state.connections.map((connection, index) => (
            <div
              className="service-row flex-wrap items-start"
              key={connection.id}
            >
              <span className="account-symbol">
                <Icon name="bank" size={18} />
              </span>
              <div className="min-w-0">
                <strong>
                  {connection.institutionName ?? `Bank connection ${index + 1}`}
                </strong>
                <p>
                  {connection.lastSyncedAt
                    ? `Last successful update: ${new Date(connection.lastSyncedAt).toLocaleString("en-US", { timeZone: state.view?.budget.settings.timezone })}`
                    : "No successful activity updates yet."}
                </p>
                {connection.accounts.length > 0 && (
                  <ul
                    className="mt-3 grid list-none gap-3"
                    aria-label="Connected bank accounts"
                  >
                    {connection.accounts.map((account) => (
                      <li
                        className="flex flex-wrap items-start justify-between gap-x-5 gap-y-1 text-sm"
                        key={account.accountId}
                      >
                        <span>
                          {account.name}
                          {account.mask ? ` · ••${account.mask}` : ""}
                          {account.subtype && (
                            <span className="muted block text-xs capitalize">
                              {account.subtype.replaceAll("_", " ")}
                            </span>
                          )}
                          {bankAccountMappings(connection.accountMappings).has(
                            account.accountId,
                          ) && (
                            <span className="muted block text-xs">
                              Added to your budget
                            </span>
                          )}
                        </span>
                        <span className="text-right tabular-nums">
                          {balance(account.currentBalance, account.currency)}
                          <span className="muted block text-xs">
                            {account.type === "credit"
                              ? "Current balance owed"
                              : "Current balance"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {connection.error && (
                  <p className="negative">{connection.error}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {hasUnmappedBankAccounts(connection) && (
                  <Button
                    variant="secondary"
                    disabled={link.busy}
                    onClick={() => setup.open(connection.id)}
                  >
                    Set up accounts
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={!available || link.busy}
                  onClick={() => void link.start(connection.id)}
                  aria-label={`Reconnect ${connection.institutionName ?? `bank connection ${index + 1}`}`}
                >
                  {link.busy && link.connectionId === connection.id
                    ? "Reconnecting…"
                    : "Reconnect"}
                </Button>
              </div>
            </div>
          ))
        ) : (
          <p className="small muted">
            {available
              ? "Connect your bank to see account balances and bring posted and pending activity into your private review inbox."
              : "Bank connection needs service setup. You can use manual accounts and transactions now."}
          </p>
        )}
        {state.connections.length > 0 && (
          <p className="small muted mt-4">
            Name your connected accounts to add them to Cash or Credit. Bank
            balances reflect the latest saved bank data; new activity appears in
            your review inbox.
          </p>
        )}
      </div>
      {setup.connection && (
        <BankAccountSetup
          key={setup.connection.id}
          state={state}
          connection={setup.connection}
          onClose={setup.close}
        />
      )}
    </section>
  );
}
