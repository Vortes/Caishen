import type { State } from "~/components/budget/types";

type Connection = State["connections"][number];

const consentDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const DAY = 24 * 60 * 60 * 1000;

export const bankName = (connection: Connection | undefined) =>
  connection?.institutionName ?? "your bank";

// What the bank reported about the connection that the user has to act on,
// from its stored status (ADR 0009): the state the panel names, the action
// that fixes it, and the sentence the status tip explains it with.
export function connectionAttention(connection: Connection): {
  label: string;
  action: "reconnect" | "link-again" | "choose";
  detail: string;
} | null {
  if (connection.disconnectedAt) return null;
  const bank = bankName(connection);
  switch (connection.status) {
    case "login_required":
      return {
        label: "Sign in again",
        action: "reconnect",
        detail: `${bank} needs you to sign in again before updates continue.`,
      };
    case "pending_disconnect": {
      // Plaid warns a week ahead; a consent date within that week is the
      // reason, and a later one is unrelated to this disconnect.
      const expires = connection.consentExpiresAt;
      return expires && expires.getTime() - Date.now() <= 8 * DAY
        ? {
            label: `Consent expires on ${consentDate.format(expires)}`,
            action: "reconnect",
            detail: `Reconnect before then to keep ${bank} updating.`,
          }
        : {
            label: "Disconnects in 7 days",
            action: "reconnect",
            detail: `${bank} will stop updating unless you reconnect.`,
          };
    }
    case "revoked":
      return {
        label: "Access revoked",
        action: "link-again",
        detail: `Access to ${bank} was revoked at the bank. Link again to continue updates.`,
      };
    default:
      return connection.newAccountsAvailable
        ? {
            label: "New accounts available",
            action: "choose",
            detail: `${bank} reports accounts you haven’t shared yet.`,
          }
        : null;
  }
}

// Whether the connection has something for the user to fix. The Banks panel
// and the sidebar's account rows both warn from this.
export const needsAttention = (connection: Connection) =>
  Boolean(connection.error) || connectionAttention(connection) !== null;
