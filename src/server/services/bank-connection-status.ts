import { z } from "zod";
import type { PlaidItemHealth } from "~/server/integrations/plaid";
import type { PlaidWebhook } from "~/server/plaid-webhook";
import { isBankConnectionTerminal } from "~/lib/bank-connection-lifecycle";

// A bank connection's status is set from what Plaid reports through Item
// webhooks and /item/get, never inferred from an account going unmentioned
// (ADR 0009). Stored as text; values may only grow (ADR 0006).
export const bankConnectionStatuses = [
  "connected",
  "login_required",
  "pending_disconnect",
  "revoked",
  "disconnected",
] as const;
export const bankConnectionStatusSchema = z.enum(bankConnectionStatuses);
export type BankConnectionStatus = z.infer<typeof bankConnectionStatusSchema>;

export interface ConnectionStatusChange {
  status?: BankConnectionStatus;
  consentExpiresAt?: Date | null;
  lastSuccessfulUpdateAt?: Date | null;
  lastFailedUpdateAt?: Date | null;
  newAccountsAvailable?: boolean;
  updateRequestedAt?: Date;
}

/**
 * The connection columns an account update stores from /item/get. A sign-in
 * problem the Item reports marks the connection; an Item with no error after
 * one was login required is connected again. A pending disconnect is only
 * ever lifted by the webhook or reconnect that resolves it, and a revoked or
 * disconnected connection keeps that status.
 */
export function itemHealthChange(
  item: PlaidItemHealth,
  current: BankConnectionStatus,
): ConnectionStatusChange {
  return {
    consentExpiresAt: item.consentExpiresAt,
    lastSuccessfulUpdateAt: item.lastSuccessfulUpdateAt,
    lastFailedUpdateAt: item.lastFailedUpdateAt,
    status: isBankConnectionTerminal({ status: current })
      ? current
      : item.errorCode === "ITEM_LOGIN_REQUIRED"
        ? "login_required"
        : item.errorCode === null && current === "login_required"
          ? "connected"
          : current,
  };
}

/**
 * What an Item webhook changes on its connection, and whether it asks for an
 * account update; null for a webhook this app does not act on. A webhook that
 * arrives after a revocation or disconnect leaves that status in place.
 * https://plaid.com/docs/api/items/#webhooks
 */
export function webhookChange(
  webhook: PlaidWebhook,
  current: BankConnectionStatus,
  now: Date,
): { change: ConnectionStatusChange; update: boolean } | null {
  const decision = itemWebhookChange(webhook, current, now);
  if (!decision || !isBankConnectionTerminal({ status: current }))
    return decision;
  const change = { ...decision.change };
  delete change.status;
  return { ...decision, change };
}

function itemWebhookChange(
  webhook: PlaidWebhook,
  current: BankConnectionStatus,
  now: Date,
): { change: ConnectionStatusChange; update: boolean } | null {
  const code = `${webhook.webhook_type}/${webhook.webhook_code}`;
  switch (code) {
    case "ITEM/ERROR":
      return webhook.error?.error_code === "ITEM_LOGIN_REQUIRED"
        ? { change: { status: "login_required" }, update: false }
        : null;
    case "ITEM/LOGIN_REPAIRED":
      return current === "login_required"
        ? { change: { status: "connected" }, update: false }
        : { change: {}, update: false };
    case "ITEM/PENDING_DISCONNECT":
      return { change: { status: "pending_disconnect" }, update: false };
    case "ITEM/PENDING_EXPIRATION":
      return {
        change: {
          status: "pending_disconnect",
          ...(webhook.consent_expiration_time
            ? { consentExpiresAt: new Date(webhook.consent_expiration_time) }
            : {}),
        },
        update: false,
      };
    case "ITEM/USER_PERMISSION_REVOKED":
      return { change: { status: "revoked" }, update: false };
    case "ITEM/NEW_ACCOUNTS_AVAILABLE":
      return { change: { newAccountsAvailable: true }, update: false };
    case "TRANSACTIONS/SYNC_UPDATES_AVAILABLE":
      return { change: { updateRequestedAt: now }, update: true };
    default:
      return null;
  }
}
