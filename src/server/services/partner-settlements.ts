import {
  bankAccountRowsSelection,
  withBankAccountSuccessors,
} from "./bank-account-rows";
import { createHash } from "node:crypto";
import { composeChangeSets } from "~/domain/change-sets";
import { counterpartyRegisterEntries } from "~/domain/counterparty";
import {
  counterpartyId,
  executeWithChanges,
  type Book,
  type Budget,
  type Command,
} from "~/domain/engine";
import {
  isRejectedSettlementImport,
  settlementLegId,
} from "~/domain/partner-settlements";
import type { ChangeSet } from "~/domain/rows";
import type { AccountingState } from "~/domain/shared-ledger";
import {
  matchSettlements,
  namesPerson,
  SETTLEMENT_MATCH_DAYS,
  type SettlementCandidate,
} from "~/lib/settlement-recognition";
import type { StoredImport } from "~/server/integrations/transactions";
import { RevisionConflictError } from "~/server/storage/rows";
import {
  bankImportEligibility,
  bankImportFingerprint as fingerprint,
} from "./bank-account-setup";
import { importStateChange, readImportStates } from "./bank-import-rows";
import { readBankConnection, type ReadConnection } from "./banks";
import {
  requireHousehold,
  writeServerOperation,
  type Database,
} from "./household";

// Money between people in bank imports, recorded as transfers to and from
// the counterparty accounts rather than as income or spending
// (src/domain/partner-settlements.ts):
//
// - a payment between the partners, once both partners' imports of it have
//   arrived and match (src/lib/settlement-recognition.ts), becomes one
//   settlement with both legs, and each import is linked to its leg;
// - a deposit naming someone who owes you through Reimbursements, for no
//   more than they owe, becomes their repayment, waiting for your review.
//
// Runs after a bank update, as its own operation, so a match can use
// imports from either partner's connections, whichever arrived last.

type Candidate = SettlementCandidate & {
  connectionId: string;
  record: StoredImport;
  accountId: string;
};

type Connections = ReadConnection<
  Awaited<ReturnType<Database["bankConnection"]["findMany"]>>[number]
>[];

export async function settleFromImports(db: Database, userId: string) {
  for (let attempt = 0; ; attempt++)
    try {
      return await settleOnce(db, userId);
    } catch (error) {
      if (!(error instanceof RevisionConflictError) || attempt >= 4)
        throw error;
    }
}

async function settleOnce(db: Database, userId: string) {
  const opened = await requireHousehold(db, userId);
  const { household, ledger } = opened;
  const memberIds = ledger.personal
    ? [userId]
    : Object.keys((ledger.state as Book).budgets);
  const [stored, profiles] = await Promise.all([
    withBankAccountSuccessors(
      db,
      db.bankConnection.findMany({
        include: { bankAccounts: bankAccountRowsSelection },
        where: { clerkUserId: { in: memberIds } },
      }),
    ),
    db.workspaceMember.findMany({
      where: { workspaceId: household.workspaceId },
      select: { clerkUserId: true, user: { select: { firstName: true } } },
    }),
  ]);
  const connections: Connections = stored.map((connection) =>
    readBankConnection(
      connection,
      readImportStates(household.rows, connection.clerkUserId),
    ),
  );
  const budgetOf = (state: AccountingState, id: string): Budget =>
    "budgets" in state ? state.budgets[id]! : state.budget;
  const candidates = connections.flatMap((read) =>
    read.status === "ready"
      ? unrecorded(read, budgetOf(ledger.state, read.connection.clerkUserId))
      : [],
  );

  let book = ledger.state;
  const changeSets: ChangeSet[] = [];
  const commands: Command[] = [];
  const linked = new Map<string, string>();
  const run = (command: Command, links: [Candidate, string][]) => {
    const result = executeWithChanges(book, userId, command, "provider");
    book = result.book;
    changeSets.push(result.changeSet);
    commands.push(command);
    for (const [candidate, transactionId] of links)
      linked.set(candidate.key, transactionId);
  };

  if (!ledger.personal) {
    // A partner goes by their profile's first name, else their budget's.
    const name = (id: string) => {
      const first = profiles
        .find((profile) => profile.clerkUserId === id)
        ?.user.firstName?.trim();
      if (first) return first;
      return budgetOf(book, id).name;
    };
    const ownCardPayment = (candidate: SettlementCandidate) =>
      ownTransfer(budgetOf(book, candidate.userId), candidates, candidate);
    for (const match of matchSettlements(candidates, name, ownCardPayment)) {
      const paid = match.paid as Candidate;
      const received = match.received as Candidate;
      const settlementId = `settlement-${digest([paid.key, received.key])}`;
      // A rejected pair keeps its stable ID so later syncs leave it in review.
      if (
        book.partnerSettlements?.some(
          (item) => item.id === settlementId && item.removed,
        )
      )
        continue;
      try {
        run(
          {
            type: "partner.settle",
            id: `settle:${digest([settlementId])}`,
            settlementId,
            method: match.method,
            legs: [paid, received].map((leg) => ({
              userId: leg.userId,
              accountId: leg.accountId,
              date: leg.date,
              amount: leg.amount,
              payee: leg.text.slice(0, 240),
              providerId: leg.record.current.providerTransactionId,
            })),
          },
          [
            [paid, settlementLegId(settlementId, paid.userId)],
            [received, settlementLegId(settlementId, received.userId)],
          ],
        );
      } catch {
        // Left waiting in both inboxes, as an unmatched import is.
      }
    }
  }

  // Your own deposits from someone who owes you through Reimbursements.
  const budget = budgetOf(book, userId);
  const owed = new Map<string, number>();
  for (const entry of counterpartyRegisterEntries(budget, {
    accountId: counterpartyId("reimbursements"),
  }))
    if (entry.counterpartyName)
      owed.set(
        entry.counterpartyName,
        (owed.get(entry.counterpartyName) ?? 0) + entry.amount,
      );
  for (const candidate of candidates) {
    if (
      candidate.userId !== userId ||
      linked.has(candidate.key) ||
      candidate.accountKind !== "cash" ||
      candidate.amount <= 0
    )
      continue;
    const from = [...owed].filter(
      ([person, amount]) =>
        amount >= candidate.amount && namesPerson(candidate.text, person),
    );
    if (from.length !== 1) continue;
    const [counterpartyName] = from[0]!;
    const id = `repaid:${digest([candidate.key])}`;
    try {
      run(
        {
          type: "counterparty.receive",
          id,
          counterpartyAccountId: counterpartyId("reimbursements"),
          cashAccountId: candidate.accountId,
          date: candidate.date,
          amount: candidate.amount,
          counterpartyName,
          payee: candidate.text.slice(0, 240),
          providerId: candidate.record.current.providerTransactionId,
        },
        [[candidate, `${id}:receipt`]],
      );
      owed.set(
        counterpartyName,
        owed.get(counterpartyName)! - candidate.amount,
      );
    } catch {
      // Left in the inbox for the user.
    }
  }

  if (!commands.length) return { settled: 0, repaid: 0 };
  const decidedAt = new Date().toISOString();
  const importChanges = connections.flatMap((read) => {
    if (read.status !== "ready") return [];
    const { connection, state } = read;
    const touched = candidates.filter(
      (candidate) =>
        candidate.connectionId === connection.id && linked.has(candidate.key),
    );
    if (!touched.length) return [];
    for (const candidate of touched)
      state.resolved[candidate.record.id] = {
        fingerprint: fingerprint(candidate.record),
        transactionId: linked.get(candidate.key)!,
        decidedAt,
      };
    return [
      importStateChange(
        household.rows,
        connection.clerkUserId,
        connection.id,
        state,
      ),
    ];
  });
  const operationId = `bank.settle:${digest(commands.map((item) => item.id))}`;
  await writeServerOperation(db, opened, {
    actorId: userId,
    operationId,
    source: "provider",
    type: "bank.settle",
    submitted: { commands: commands.map((command) => command.id) },
    changeSet: composeChangeSets(operationId, [
      ...changeSets,
      ...importChanges,
    ]),
  });
  return {
    settled: commands.filter((command) => command.type === "partner.settle")
      .length,
    repaid: commands.filter(
      (command) => command.type === "counterparty.receive",
    ).length,
  };
}

// A connection's posted imports that no budget transaction records yet, in
// the cash accounts and credit cards they're mapped to.
function unrecorded(
  read: Extract<Connections[number], { status: "ready" }>,
  budget: Budget,
): Candidate[] {
  const { connection, state } = read;
  const mappings = read.importMappings ?? read.mappings;
  return state.records.flatMap((record): Candidate[] => {
    const mapping = mappings[record.current.providerAccountId];
    const account = budget.accounts.find(
      (item) => item.id === mapping?.accountId,
    );
    if (
      !mapping ||
      (account?.kind !== "cash" && account?.kind !== "credit") ||
      record.removed ||
      record.current.pending ||
      record.matchStatus !== "confirmed" ||
      state.resolved[record.id] ||
      isRejectedSettlementImport(budget, record.providerTransactionIds) ||
      bankImportEligibility(mapping, record) !== "eligible" ||
      budget.transactions.some(
        (transaction) =>
          !transaction.removed &&
          transaction.providerId === record.current.providerTransactionId,
      )
    )
      return [];
    return [
      {
        key: `${connection.id}\u0000${record.id}`,
        userId: connection.clerkUserId,
        connectionId: connection.id,
        record,
        accountId: account.id,
        accountKind: account.kind,
        date: record.current.date,
        amount: -record.current.amountCents,
        text: record.current.merchantName ?? record.current.name,
      },
    ];
  });
}

// Whether a card payment is between one partner's own accounts: the same
// amount left their cash account into their own card (or the other way
// round), in their budget or their imports, within the match window.
function ownTransfer(
  budget: Budget,
  candidates: Candidate[],
  candidate: SettlementCandidate,
): boolean {
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const kind = (accountId: string) =>
    budget.accounts.find((account) => account.id === accountId)?.kind;
  const counterpart = (date: string, amount: number, accountKind?: string) =>
    amount === -candidate.amount &&
    accountKind === (candidate.amount < 0 ? "credit" : "cash") &&
    Math.abs(day(date) - day(candidate.date)) <= SETTLEMENT_MATCH_DAYS;
  return (
    budget.transactions.some(
      (transaction) =>
        !transaction.removed &&
        counterpart(
          transaction.date,
          transaction.amount,
          kind(transaction.accountId),
        ),
    ) ||
    candidates.some(
      (other) =>
        other.userId === candidate.userId &&
        counterpart(other.date, other.amount, other.accountKind),
    )
  );
}

const digest = (parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
