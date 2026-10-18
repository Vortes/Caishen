"use client";

import { useState } from "react";
import { api, type RouterOutputs } from "~/trpc/react";
import { Amount, FormField, Icon, SelectField } from "~/components/ui";

type State = NonNullable<RouterOutputs["budget"]["state"]>;
type PlaidHandler = { open: () => void; destroy: () => void };
type PlaidSdk = {
  create: (options: {
    token: string;
    onSuccess: (publicToken: string) => void;
    onExit: (
      error: { display_message?: string; error_message?: string } | null,
    ) => void;
  }) => PlaidHandler;
};
declare global {
  interface Window {
    Plaid?: PlaidSdk;
  }
}

async function loadPlaid() {
  if (window.Plaid) return window.Plaid;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new Error(
          "Plaid Link could not load. Check your connection and try again.",
        ),
      );
    document.head.appendChild(script);
  });
  if (!window.Plaid)
    throw new Error("Plaid Link did not initialize. Try again.");
  return window.Plaid;
}

export function BankConnections({ state }: { state: State }) {
  const utils = api.useUtils();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const token = api.budget.plaidLinkToken.useMutation();
  const exchange = api.budget.plaidExchange.useMutation();
  const available =
    state.services.find((service) => service.name === "Plaid")?.status ===
    "configured";
  const connect = async () => {
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const [sdk, result] = await Promise.all([
        loadPlaid(),
        token.mutateAsync(),
      ]);
      const handler = sdk.create({
        token: result.linkToken,
        onSuccess: (publicToken) => {
          void exchange
            .mutateAsync({ publicToken })
            .then(async () => {
              await utils.budget.state.invalidate();
              setMessage(
                "Bank connection saved. Update accounts, then map each bank account in the review inbox.",
              );
            })
            .catch((failure: unknown) =>
              setError(
                failure instanceof Error
                  ? failure.message
                  : "The connection could not be saved.",
              ),
            )
            .finally(() => {
              setLoading(false);
              handler.destroy();
            });
        },
        onExit: (failure) => {
          if (failure)
            setError(
              failure.display_message ??
                failure.error_message ??
                "Plaid connection ended before completion.",
            );
          setLoading(false);
          handler.destroy();
        },
      });
      handler.open();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Bank connection could not start.",
      );
      setLoading(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Bank connections</h2>
          <p>
            Plaid · Chase, Amex, and Discover eligibility depends on the
            institution.
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!available || loading}
          onClick={connect}
        >
          {loading ? "Connecting…" : "Connect a bank"}
          <Icon name="arrow" size={14} />
        </button>
      </div>
      <div className="panel-body">
        {error && (
          <p className="form-error" role="alert">
            ! {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        {state.connections.length ? (
          state.connections.map((connection, index) => (
            <div className="service-row" key={connection.id}>
              <span className="account-symbol">
                <Icon name="bank" size={18} />
              </span>
              <div>
                <strong>Bank connection {index + 1}</strong>
                <p>
                  {connection.lastSyncedAt
                    ? `Last successful update: ${new Date(connection.lastSyncedAt).toLocaleString("en-US", { timeZone: state.view?.budget.settings.timezone })}`
                    : "No successful updates yet."}
                </p>
                {connection.error && (
                  <p className="negative">{connection.error}</p>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="small muted">
            {available
              ? "Connect your institution to bring posted and pending activity into your private inbox."
              : "Bank connection needs service setup. You can use manual accounts and transactions now."}
          </p>
        )}
      </div>
    </section>
  );
}

export function BankInbox({ state }: { state: State }) {
  const [error, setError] = useState("");
  const utils = api.useUtils();
  const refresh = () => utils.budget.state.invalidate();
  const map = api.budget.mapBankAccount.useMutation({
    onSuccess: refresh,
    onError: (failure) => setError(failure.message),
  });
  const resolve = api.budget.resolveImport.useMutation({
    onSuccess: refresh,
    onError: (failure) => setError(failure.message),
  });
  const view = state.view;
  if (!view || !state.imports.length) return null;
  const busy = map.isPending || resolve.isPending;
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>Bank activity to review</h2>
          <p>
            Confirm bank facts, categories, and uncertain matches before adding
            them to your ledger.
          </p>
        </div>
        <span className="badge review">{state.imports.length} to review</span>
      </div>
      <div className="panel-body">
        {error && (
          <p className="form-error" role="alert">
            ! {error}
          </p>
        )}
        <div className="stack">
          {state.imports.map((item) => (
            <div
              className="bank-review-item"
              key={`${item.connectionId}:${item.logicalId}`}
            >
              <div className="bank-review-heading">
                <div>
                  <strong>{item.payee}</strong>
                  <p className="small muted">
                    {item.date} · {item.pending ? "Pending" : "Posted"}
                    {item.removed ? " · Removed by bank" : ""}
                    {item.needsMatchReview ? " · Match needs review" : ""}
                  </p>
                </div>
                <Amount value={item.amount} signed />
              </div>
              {item.error && <p className="form-error">! {item.error}</p>}
              {!item.accountId ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    map.mutate({
                      connectionId: item.connectionId,
                      providerAccountId: item.providerAccountId,
                      accountId: formText(data, "accountId"),
                      startDate: formText(data, "startDate"),
                    });
                  }}
                >
                  <p className="field-hint">
                    Map bank account {item.providerAccountId} to your own
                    ledger. Choose an import start date after the opening
                    balance date to avoid importing that balance twice.
                  </p>
                  <div className="form-row" style={{ marginTop: 12 }}>
                    <SelectField
                      name="accountId"
                      label="Your ledger account"
                      required
                    >
                      {view.accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.name}
                        </option>
                      ))}
                    </SelectField>
                    <FormField
                      name="startDate"
                      label="Import activity beginning"
                      type="date"
                      required
                    />
                  </div>
                  <button
                    className="secondary-button"
                    style={{ marginTop: 12 }}
                    disabled={busy || !view.accounts.length}
                  >
                    Map account
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setError("");
                    const data = new FormData(event.currentTarget);
                    const existingTransactionId = data.get(
                      "existingTransactionId",
                    );
                    const categoryId = data.get("categoryId");
                    if (
                      !existingTransactionId &&
                      item.amount < 0 &&
                      !categoryId
                    ) {
                      setError(
                        "Choose a category for the new purchase, or link an existing ledger record.",
                      );
                      return;
                    }
                    resolve.mutate({
                      connectionId: item.connectionId,
                      logicalId: item.logicalId,
                      expectedRevision: state.revision,
                      existingTransactionId:
                        typeof existingTransactionId === "string" &&
                        existingTransactionId
                          ? existingTransactionId
                          : undefined,
                      command:
                        typeof existingTransactionId === "string" &&
                        existingTransactionId
                          ? undefined
                          : {
                              type: "transaction.upsert",
                              id: crypto.randomUUID(),
                              transactionId: crypto.randomUUID(),
                              accountId: item.accountId!,
                              date: item.date,
                              amount: item.amount,
                              payee: item.payee,
                              categoryId:
                                typeof categoryId === "string" && categoryId
                                  ? categoryId
                                  : undefined,
                              status: item.pending ? "pending" : "posted",
                              reviewed: false,
                            },
                    });
                  }}
                >
                  <div className="form-row" style={{ marginTop: 12 }}>
                    <SelectField
                      name="existingTransactionId"
                      label="Already in your ledger?"
                    >
                      <option value="">Create a new purchase / inflow</option>
                      {view.budget.transactions
                        .filter(
                          (transaction) =>
                            !transaction.removed &&
                            transaction.accountId === item.accountId &&
                            transaction.date === item.date &&
                            transaction.amount === item.amount,
                        )
                        .map((transaction) => (
                          <option key={transaction.id} value={transaction.id}>
                            {transaction.payee} · {transaction.kind}
                          </option>
                        ))}
                    </SelectField>
                    <SelectField
                      name="categoryId"
                      label="Category for new purchase"
                    >
                      <option value="">
                        {item.amount > 0
                          ? "Ready to Assign"
                          : "Choose category"}
                      </option>
                      {view.categories
                        .filter(
                          (category) =>
                            !category.pairedAccountId && !category.pairedLoanId,
                        )
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </SelectField>
                  </div>
                  <p className="field-hint" style={{ marginTop: 7 }}>
                    For card, loan, or partner payments, record the dedicated
                    payment first, then link its ledger record. A suggested
                    match is never accepted from amount similarity alone.
                  </p>
                  <div className="heading-actions" style={{ marginTop: 12 }}>
                    <button
                      className="secondary-button"
                      disabled={busy || item.removed}
                    >
                      {busy ? "Saving…" : "Confirm bank activity"}
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        resolve.mutate({
                          connectionId: item.connectionId,
                          logicalId: item.logicalId,
                          expectedRevision: state.revision,
                          ignore: true,
                        })
                      }
                    >
                      Ignore this provider record
                    </button>
                  </div>
                </form>
              )}
              <details style={{ marginTop: 10 }}>
                <summary className="small muted">
                  Bank update history · {item.history.length} records
                </summary>
                <p className="field-hint">
                  Bank records are retained for inspection. Pending-to-posted
                  changes stay linked when the provider establishes the match.
                </p>
                <ul className="audit-list">
                  {item.history.map((entry, index) => (
                    <li key={index}>
                      <span>{entry.kind}</span>
                      <span className="muted">
                        Provider revision {index + 1}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formText(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
