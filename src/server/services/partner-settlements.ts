import { withBankAccountSuccessors } from "./bank-account-rows";
import { bankAccountRowsSelection } from "./bank-account-rows";
import { migrateBankAccounts } from "./bank-account-migration";
import { isCardPaymentOutflow } from "~/lib/card-payment-recognition";
import { matchesManualImport } from "~/domain/bank-import-balances";
import {
  transferCounterparts,
  transferImportCommand,
} from "~/domain/transfers";
import { rememberedPaymentDestinations } from "./bank-payment-memory";
import { reimbursementShareForPayee } from "~/domain/payee-memory";
import { createHash } from "node:crypto";
import { composeChangeSets } from "~/domain/change-sets";
import { counterpartyRegisterEntries } from "~/domain/counterparty";
import {
  AccountingError,
  isCounterparty,
  executeWithChanges,
  type Book,
  type Budget,
  type Command,
  type Transaction,
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

// Payments in bank imports, recorded as transfers between owned accounts or
// to and from counterparty accounts rather than as income or spending
// (src/domain/partner-settlements.ts):
//
// - a uniquely matching checking outflow and card inflow become one card
//   payment, retaining each bank's posting date and provider identity;
// - a payment between the partners, once both partners' imports of it have
//   arrived and match (src/lib/settlement-recognition.ts), becomes one
//   settlement with both legs, and each import is linked to its leg;
// - a deposit naming a person (not the partner) who owes you, for no
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
  for (const memberId of memberIds)
    await migrateBankAccounts(db, memberId, { reportUnreadable: false });
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
  const recorded = new Set(
    connections.flatMap((read) =>
      read.status === "ready" && read.connection.clerkUserId === userId
        ? Object.values(read.state.resolved).flatMap((resolution) =>
            resolution.transactionId ? [resolution.transactionId] : [],
          )
        : [],
    ),
  );
  const manualMatch = (transaction: Transaction, candidate: Candidate) =>
    !recorded.has(transaction.id) &&
    matchesManualImport(transaction, candidate);
  const run = (command: Command, links: [Candidate, string][]) => {
    const result = executeWithChanges(book, userId, command, "provider");
    book = result.book;
    changeSets.push(result.changeSet);
    commands.push(command);
    for (const [candidate, transactionId] of links) {
      linked.set(candidate.key, transactionId);
      recorded.add(transactionId);
    }
  };

  const own = candidates.filter((candidate) => candidate.userId === userId);
  const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const destinations = rememberedPaymentDestinations(
    budgetOf(book, userId),
    connections.flatMap((read) =>
      read.status === "ready" && read.connection.clerkUserId === userId
        ? [read.state]
        : [],
    ),
  );
  const destinationsOf = (candidate: Candidate) =>
    destinations(
      candidate.accountId,
      candidate.record.current.name,
      candidate.amount,
    );
  for (const candidate of own) {
    const budget = budgetOf(book, userId);
    const existing = budget.transactions.filter(
      (transaction) =>
        transaction.kind === "card-payment" &&
        manualMatch(transaction, candidate),
    );
    if (existing.length !== 1) continue;
    const transaction = existing[0]!;
    const counterpart = transferCounterparts(budget, transaction)[0];
    if (
      counterpart &&
      (counterpart.providerId || recorded.has(counterpart.id)) &&
      own.some(
        (other) =>
          !linked.has(other.key) &&
          other.accountId === counterpart.accountId &&
          other.amount === -candidate.amount &&
          Math.abs(day(other.date) - day(candidate.date)) <=
            SETTLEMENT_MATCH_DAYS,
      )
    )
      continue;
    if (
      own.filter(
        (other) => !linked.has(other.key) && manualMatch(transaction, other),
      ).length !== 1
    )
      continue;
    const command = transferImportCommand(budget, transaction, {
      id: `payment-match:${digest([candidate.key])}`,
      date: candidate.date,
      amount: candidate.amount,
      providerId: candidate.record.current.providerTransactionId,
    });
    if (!command) continue;
    try {
      run(command, [[candidate, transaction.id]]);
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
    }
  }
  const paymentText = (candidate: Candidate) =>
    /\b(?:payment|autopay|pmt)\b/i.test(candidate.record.current.name);
  const matches = (cash: Candidate, card: Candidate) =>
    !linked.has(cash.key) &&
    !linked.has(card.key) &&
    cash.accountKind === "cash" &&
    cash.amount < 0 &&
    card.accountKind === "credit" &&
    card.amount === -cash.amount &&
    Math.abs(day(cash.date) - day(card.date)) <= SETTLEMENT_MATCH_DAYS &&
    (destinationsOf(cash).length
      ? destinationsOf(cash).includes(card.accountId)
      : destinationsOf(card).includes(cash.accountId) ||
        isCardPaymentOutflow(cash.record.current.name)) &&
    (destinationsOf(card).length
      ? destinationsOf(card).includes(cash.accountId)
      : destinationsOf(cash).length > 0 || paymentText(card));
  const recordPayment = (
    payment: Candidate,
    accountId: string,
    counterpart?: Candidate,
  ) => {
    const id = `card-payment:${digest(counterpart ? [payment.key, counterpart.key] : [payment.key])}`;
    const links: [Candidate, string][] = [[payment, `${id}:payment`]];
    if (counterpart) links.push([counterpart, `${id}:counterpart`]);
    try {
      run(
        {
          type: "transaction.upsert",
          id,
          transactionId: `${id}:payment`,
          accountId: payment.accountId,
          transferAccountId: accountId,
          date: payment.date,
          amount: payment.amount,
          payee: payment.text.slice(0, 240),
          providerId: payment.record.current.providerTransactionId,
          status: "posted",
          cleared: true,
          ...(counterpart
            ? {
                transferCounterpart: {
                  date: counterpart.date,
                  providerId: counterpart.record.current.providerTransactionId,
                },
              }
            : {}),
        },
        links,
      );
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
      // A payment the ledger cannot record stays in the bank inbox.
    }
  };
  for (const cash of own) {
    const cards = own.filter((card) => matches(cash, card));
    if (cards.length !== 1) continue;
    const card = cards[0]!;
    if (own.filter((other) => matches(other, card)).length !== 1) continue;
    // A hand-entered payment must be matched, rather than counted again.
    if (
      [cash, card].some((candidate) =>
        budgetOf(book, userId).transactions.some((transaction) =>
          manualMatch(transaction, candidate),
        ),
      )
    )
      continue;
    recordPayment(cash, card.accountId, card);
  }

  for (const candidate of own) {
    if (linked.has(candidate.key)) continue;
    const accounts = destinationsOf(candidate);
    if (accounts.length !== 1) continue;
    const budget = budgetOf(book, userId);
    const other = budget.accounts.find((account) => account.id === accounts[0]);
    if (
      !other ||
      !(
        (candidate.accountKind === "cash" &&
          candidate.amount < 0 &&
          other.kind === "credit") ||
        (candidate.accountKind === "credit" &&
          candidate.amount > 0 &&
          other.kind === "cash")
      )
    )
      continue;
    if (
      budget.transactions.some((transaction) =>
        manualMatch(transaction, candidate),
      )
    )
      continue;
    if (
      own.some(
        (item) =>
          !linked.has(item.key) &&
          item.accountId === other.id &&
          item.amount === -candidate.amount &&
          Math.abs(day(item.date) - day(candidate.date)) <=
            SETTLEMENT_MATCH_DAYS,
      )
    )
      continue;
    recordPayment(candidate, other.id);
  }

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
    for (const match of matchSettlements(
      candidates.filter((candidate) => !linked.has(candidate.key)),
      name,
      ownCardPayment,
    )) {
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

  // Fill only empty purchases whose payee already names a reimbursement person.
  for (const transaction of budgetOf(book, userId).transactions) {
    if (
      transaction.removed ||
      transaction.kind !== "purchase" ||
      transaction.status !== "posted" ||
      transaction.categoryId ||
      transaction.counterpartyShare ||
      transaction.lines?.length
    )
      continue;
    const share = reimbursementShareForPayee(
      budgetOf(book, userId),
      transaction,
    );
    if (!share) continue;
    try {
      run(
        {
          type: "transaction.upsert",
          id: `reimbursement-payee:${digest([userId, transaction.id, String(transaction.revision)])}`,
          transactionId: transaction.id,
          revision: transaction.revision + 1,
          accountId: transaction.accountId,
          date: transaction.date,
          expenseMonth: transaction.expenseMonth,
          amount: transaction.amount,
          payee: transaction.payee,
          status: transaction.status,
          cleared: transaction.cleared,
          providerId: transaction.providerId,
          counterpartyShare: share,
        },
        [],
      );
    } catch (error) {
      if (!(error instanceof AccountingError)) throw error;
    }
  }

  // Your own deposits from a person who owes you, by their account's name.
  // The partner's payments are settlements instead.
  const budget = budgetOf(book, userId);
  const people = new Map(
    budget.accounts
      .filter(
        (account) =>
          isCounterparty(account) && !account.linkedUserId && !account.closed,
      )
      .map((account) => [account.id, account.name]),
  );
  const owed = new Map<string, number>();
  for (const entry of counterpartyRegisterEntries(budget))
    if (people.has(entry.accountId))
      owed.set(
        entry.accountId,
        (owed.get(entry.accountId) ?? 0) + entry.amount,
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
      ([accountId, amount]) =>
        amount >= candidate.amount &&
        namesPerson(candidate.text, people.get(accountId)!),
    );
    if (from.length !== 1) continue;
    const [personId] = from[0]!;
    const id = `repaid:${digest([candidate.key])}`;
    try {
      run(
        {
          type: "counterparty.receive",
          id,
          counterpartyAccountId: personId,
          cashAccountId: candidate.accountId,
          date: candidate.date,
          amount: candidate.amount,
          payee: candidate.text.slice(0, 240),
          providerId: candidate.record.current.providerTransactionId,
        },
        [[candidate, `${id}:receipt`]],
      );
      owed.set(personId, owed.get(personId)! - candidate.amount);
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
    settled: commands.filter(
      (command) =>
        command.type === "partner.settle" ||
        command.type === "transaction.upsert",
    ).length,
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
