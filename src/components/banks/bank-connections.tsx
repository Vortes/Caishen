"use client";

import { Button } from "~/components/ui/button";

import { useState } from "react";
import { api } from "~/trpc/react";
import { type State } from "~/components/budget/types";
import { Icon } from "~/components/shared";

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
        <Button
          type="button"
          variant="secondary"
          disabled={!available || loading}
          onClick={connect}
        >
          {loading ? "Connecting…" : "Connect a bank"}
          <Icon name="arrow" size={14} />
        </Button>
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
