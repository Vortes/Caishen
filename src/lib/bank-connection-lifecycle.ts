// Revoked and disconnected are terminal: no update can reach the Item, and
// only a new link or a reconnect leaves them, never a webhook or an account
// update. A disconnect is recorded twice, as the status and as disconnectedAt
// in the connection's stored details; both are read here.
export const terminalBankConnectionStatuses = [
  "revoked",
  "disconnected",
] as const;

type ConnectionState = {
  status?: string | null;
  disconnectedAt?: string | Date | null;
};

export function isBankConnectionDisconnected(connection: ConnectionState) {
  return (
    Boolean(connection.disconnectedAt) || connection.status === "disconnected"
  );
}

/** Whether no update can run for the connection. */
export function isBankConnectionTerminal(connection: ConnectionState) {
  return (
    isBankConnectionDisconnected(connection) ||
    (
      terminalBankConnectionStatuses as readonly (string | null | undefined)[]
    ).includes(connection.status)
  );
}
