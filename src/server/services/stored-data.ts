import { TRPCError } from "@trpc/server";
import type { ZodError } from "zod";
import type { StoredIssue } from "~/server/storage/rows";

// Stored data that this code can't read raises this alert and is never
// written over (ADR 0006). Search the server logs for the tag.
export const STORED_DATA_ALERT = "stored-data-unreadable";

export const BUDGET_MAINTENANCE_MESSAGE =
  "We’re doing some maintenance. Your plan will be back in a couple of minutes. Check back later.";
export const CONNECTION_MAINTENANCE_MESSAGE =
  "This bank connection is under maintenance. It will be back in a couple of minutes.";

type StoredRecord =
  | { record: "rows"; workspaceId: string; userId: string }
  | {
      record:
        | "BankConnection.imports"
        | "BankConnection.accountMappings"
        | "BankImport"
        | "BankAccount";
      connectionId: string;
      userId: string;
    }
  | { record: "DailyDelivery.payload"; deliveryId: string; userId: string };

/** What didn't read in one part of a stored record. */
export type StoredFailure = {
  part?: string;
  ownerId?: string;
  viewerId?: string;
  issues: StoredIssue[];
};

export function zodIssues(error: ZodError): StoredIssue[] {
  return error.issues.map(({ path, code, message }) => ({
    path,
    code,
    message,
  }));
}

// One structured line per unreadable read, so log alerting can match the tag.
export function reportUnreadable(
  record: StoredRecord,
  failures: StoredFailure[],
) {
  console.error(
    `${STORED_DATA_ALERT} ${JSON.stringify({
      alert: STORED_DATA_ALERT,
      ...record,
      failures: failures.map((failure) => ({
        ...(failure.part ? { part: failure.part } : {}),
        ...(failure.ownerId ? { budgetOwnerId: failure.ownerId } : {}),
        ...(failure.viewerId ? { viewerId: failure.viewerId } : {}),
        issues: failure.issues.slice(0, 20),
      })),
    })}`,
  );
}

export function budgetMaintenance() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: BUDGET_MAINTENANCE_MESSAGE,
  });
}

export function connectionMaintenance() {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: CONNECTION_MAINTENANCE_MESSAGE,
  });
}
