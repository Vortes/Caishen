import { TRPCError } from "@trpc/server";
import type { ZodError } from "zod";
import { ownBudget, type Budget } from "~/domain/engine";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  openPersonalBudget,
  storeState,
  type StoredDataFailure,
  type StoredDataIssue,
} from "~/domain/stored-book";

// Stored data that this code can't read raises this alert and is never
// written over (ADR 0006). Search the server logs for the tag.
export const STORED_DATA_ALERT = "stored-data-unreadable";

export const BUDGET_MAINTENANCE_MESSAGE =
  "We’re doing some maintenance. Your plan will be back in a couple of minutes. Check back later.";
export const CONNECTION_MAINTENANCE_MESSAGE =
  "This bank connection is under maintenance. It will be back in a couple of minutes.";

type StoredRecord =
  | {
      record: "Workspace.book" | "Workspace.history";
      workspaceId: string;
      userId: string;
    }
  | {
      record: "BankConnection.imports" | "BankConnection.accountMappings";
      connectionId: string;
      userId: string;
    }
  | { record: "ReviewEvidence.result"; evidenceId: string; userId: string }
  | { record: "DailyDelivery.payload"; deliveryId: string; userId: string };

export function zodIssues(error: ZodError): StoredDataIssue[] {
  return error.issues.map(({ path, code, message }) => ({
    path,
    code,
    message,
  }));
}

// One structured line per unreadable read, so log alerting can match the tag.
export function reportUnreadable(
  record: StoredRecord,
  failures: (Partial<StoredDataFailure> & { issues: StoredDataIssue[] })[],
) {
  console.error(
    `${STORED_DATA_ALERT} ${JSON.stringify({
      alert: STORED_DATA_ALERT,
      ...record,
      failures: failures.map((failure) => ({
        ...("part" in failure ? { part: failure.part } : {}),
        ...("ownerId" in failure ? { budgetOwnerId: failure.ownerId } : {}),
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

type StoredWorkspace = { id: string; book: unknown };

// Reads one partner's plan from the stored household, alerting once for
// anything unreadable.
export function readBudget(workspace: StoredWorkspace, userId: string) {
  const read = openPersonalBudget(workspace.book, userId);
  if (read.failures.length)
    reportUnreadable(
      { record: "Workspace.book", workspaceId: workspace.id, userId },
      read.failures,
    );
  return read;
}

export type OpenBudget = {
  state: AccountingState;
  budget: Budget;
  store: (next: AccountingState) => unknown;
};

// Reads one partner's plan for a change, refusing while it's under
// maintenance so an unreadable budget is never saved over.
export function openBudget(
  workspace: StoredWorkspace,
  userId: string,
): OpenBudget {
  const read = readBudget(workspace, userId);
  if (read.status === "maintenance") throw budgetMaintenance();
  return {
    state: read.state,
    budget: ownBudget(read.state, userId),
    store: (next) => storeState(workspace.book, next),
  };
}
