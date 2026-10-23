import type {
  Account,
  Assignment,
  Budget,
  Category,
  Loan,
  Obligation,
  PayeeMemory,
  Reimbursement,
  Settlement,
  SharedCategory,
  Transaction,
} from "./engine";
import type { PartnerEntry } from "./partner-ledger";
import type { PartnerSettlement } from "./partner-settlements";
import {
  accountRow,
  assignmentRow,
  categoryRows,
  diffRows,
  expectedIncomeRows,
  groupRows,
  loanRows,
  memberRows,
  openingObligationRows,
  partnerEntryRow,
  partnerFactRows,
  partnerSettlementRow,
  partnerSideRows,
  payeeMemoryRows,
  reimbursementRows,
  settlementRows,
  sharedCategoryRows,
  transactionRows,
  type ChangeSet,
  type WireRow,
} from "./rows";
import { isPersonalLedger, type AccountingState } from "./shared-ledger";

/**
 * Records what a command changes (ADR 0006). The engine obtains every entity
 * it writes through this tracker, which records the entity's rows the first
 * time it is touched; creations and removals are recorded the same way. The
 * change set compares those rows with the touched entities' rows at the end,
 * so only what was touched is ever compared.
 *
 * A write that skips the tracker is a miss: the change-set oracle in the
 * tests compares every command's change set with a full comparison of the
 * ledger's rows and fails on any miss or extra.
 */
export class Changes {
  // Each touched part's current rows, and its rows when first touched.
  private readonly parts = new Map<string, () => WireRow[]>();
  private readonly before = new Map<string, WireRow[]>();
  // Partner facts per viewer when a part they derive from was first touched.
  private readonly facts = new Map<string, WireRow[]>();
  private readonly positions = new WeakMap<object, Map<string, number>>();
  // Each touched transaction as it was when first touched.
  private readonly edited = new Map<
    string,
    { budget: Budget; id: string; before?: Transaction }
  >();

  constructor(private readonly state: AccountingState) {}

  private touch(key: string, rows: () => WireRow[]): void {
    if (this.parts.has(key)) return;
    this.parts.set(key, rows);
    this.before.set(key, rows());
  }

  // Partner facts derive from each budget's transactions, the settlements,
  // and the shared categories; only the household's whole book holds the
  // partner's side, so a personal ledger's change sets never include them.
  private touchFacts(changedBudget?: Budget): void {
    const state = this.state;
    if (isPersonalLedger(state)) return;
    for (const viewerId of Object.keys(state.budgets))
      if (viewerId !== changedBudget?.userId && !this.facts.has(viewerId))
        this.facts.set(viewerId, partnerFactRows(state, viewerId));
  }

  // An item's position in its collection, which is its sort.
  private position<T>(
    items: T[],
    key: string,
    keyOf: (item: T) => string,
  ): number {
    let positions = this.positions.get(items);
    let found = positions?.get(key);
    const current = found === undefined ? undefined : items[found];
    if (found !== undefined && current !== undefined && keyOf(current) === key)
      return found;
    if (positions?.size === items.length) return -1;
    positions = new Map();
    items.forEach((item, index) => {
      if (!positions.has(keyOf(item))) positions.set(keyOf(item), index);
    });
    this.positions.set(items, positions);
    found = positions.get(key);
    return found ?? -1;
  }

  private item<T extends { id: string }>(
    key: string,
    items: () => T[],
    id: string,
    rows: (item: T, sort: number) => WireRow[],
  ): void {
    this.touch(key, () => {
      const list = items();
      const index = this.position(list, id, (item) => item.id);
      return index < 0 ? [] : rows(list[index]!, index);
    });
  }

  private memberSort(budget: Budget): number {
    const state = this.state;
    return isPersonalLedger(state)
      ? state.members.findIndex((member) => member.userId === budget.userId)
      : Object.keys(state.budgets).indexOf(budget.userId);
  }

  /** The budget's own fields: its name, start month, and settings. */
  budget(budget: Budget): Budget {
    this.touch(`member ${budget.userId}`, () =>
      memberRows(budget, this.memberSort(budget)),
    );
    return budget;
  }

  account(budget: Budget, account: Account): Account {
    this.item(
      `account ${budget.userId} ${account.id}`,
      () => budget.accounts,
      account.id,
      (item, sort) => [accountRow(budget.userId, item, sort)],
    );
    return account;
  }

  addAccount(budget: Budget, account: Account): void {
    this.account(budget, account);
    budget.accounts.push(account);
  }

  /** The category group list, which the caller replaces. */
  groups(budget: Budget): void {
    this.touch(`groups ${budget.userId}`, () => groupRows(budget));
  }

  /** A category with its target. */
  category(budget: Budget, category: Category): Category {
    this.item(
      `category ${budget.userId} ${category.id}`,
      () => budget.categories,
      category.id,
      (item, sort) => categoryRows(budget.userId, item, sort),
    );
    return category;
  }

  addCategory(budget: Budget, category: Category): void {
    this.category(budget, category);
    budget.categories.push(category);
  }

  /** The category's assignment for the month, if it has one. */
  assignment(
    budget: Budget,
    categoryId: string,
    month: string,
  ): Assignment | undefined {
    const key = `${month}:${categoryId}`;
    const find = () =>
      this.position(
        budget.assignments,
        key,
        (assignment) => `${assignment.month}:${assignment.categoryId}`,
      );
    this.touch(`assignment ${budget.userId} ${key}`, () => {
      const index = find();
      return index < 0
        ? []
        : [assignmentRow(budget.userId, budget.assignments[index]!, index)];
    });
    return budget.assignments[find()];
  }

  addAssignment(budget: Budget, assignment: Assignment): void {
    this.assignment(budget, assignment.categoryId, assignment.month);
    budget.assignments.push(assignment);
  }

  /** The month's expected income, which the caller sets or clears. */
  expectedIncome(budget: Budget, month: string): Budget["expectedIncome"] {
    this.touch(`income ${budget.userId} ${month}`, () =>
      expectedIncomeRows(
        budget.userId,
        month,
        Object.hasOwn(budget.expectedIncome, month)
          ? budget.expectedIncome[month]
          : undefined,
      ),
    );
    return budget.expectedIncome;
  }

  /** A transaction with its shares and history. */
  transaction(budget: Budget, transaction: Transaction): Transaction {
    this.touchTransaction(budget, transaction.id);
    return transaction;
  }

  private touchTransaction(budget: Budget, id: string): void {
    const key = `${budget.userId} ${id}`;
    if (!this.edited.has(key)) {
      const index = this.position(budget.transactions, id, (item) => item.id);
      this.edited.set(key, {
        budget,
        id,
        before:
          index < 0 ? undefined : structuredClone(budget.transactions[index]),
      });
    }
    this.touchFacts(budget);
    this.item(
      `transaction ${budget.userId} ${id}`,
      () => budget.transactions,
      id,
      (item, sort) => transactionRows(budget.userId, item, sort),
    );
  }

  addTransaction(budget: Budget, transaction: Transaction): void {
    this.touchTransaction(budget, transaction.id);
    budget.transactions.push(transaction);
  }

  /** Saves a transaction in place of the one with its id, or adds it. */
  putTransaction(budget: Budget, transaction: Transaction): void {
    this.touchTransaction(budget, transaction.id);
    const index = this.position(
      budget.transactions,
      transaction.id,
      (item) => item.id,
    );
    if (index < 0) budget.transactions.push(transaction);
    else budget.transactions[index] = transaction;
  }

  /** The budget's transactions this command touched, before and now. */
  transactionEdits(
    budget: Budget,
  ): { before?: Transaction; after?: Transaction }[] {
    return [...this.edited.values()]
      .filter((edit) => edit.budget === budget)
      .map(({ id, before }) => {
        const index = this.position(budget.transactions, id, (item) => item.id);
        return { before, after: budget.transactions[index] };
      });
  }

  /** The payee memory, whose entry for this payee key the caller sets. */
  payeeMemory(budget: Budget, key: string): Record<string, PayeeMemory> {
    this.touch(`payee ${budget.userId} ${key}`, () =>
      payeeMemoryRows(budget.userId, key, budget.payeeMemory?.[key]),
    );
    return (budget.payeeMemory ??= {});
  }

  /** One partner's private sides of partner ledger entries. */
  partnerSide(
    budget: Budget,
    entryId: string,
  ): NonNullable<Budget["partnerSides"]> {
    this.touch(`partner side ${budget.userId} ${entryId}`, () =>
      partnerSideRows(budget.userId, entryId, budget.partnerSides?.[entryId]),
    );
    return (budget.partnerSides ??= {});
  }

  /** A partner ledger entry, which both partners' browsers hold. */
  partnerEntry(entry: PartnerEntry): PartnerEntry {
    this.item(
      `partner entry ${entry.id}`,
      () => this.state.partnerEntries ?? [],
      entry.id,
      (item, sort) => [partnerEntryRow(item, sort)],
    );
    return entry;
  }

  addPartnerEntry(entry: PartnerEntry): void {
    this.partnerEntry(entry);
    (this.state.partnerEntries ??= []).push(entry);
  }

  /** A settlement between the partners, which both browsers hold. */
  partnerSettlement(settlement: PartnerSettlement): PartnerSettlement {
    this.item(
      `partner settlement ${settlement.id}`,
      () => this.state.partnerSettlements ?? [],
      settlement.id,
      (item, sort) => [partnerSettlementRow(item, sort)],
    );
    return settlement;
  }

  addPartnerSettlement(settlement: PartnerSettlement): void {
    this.partnerSettlement(settlement);
    (this.state.partnerSettlements ??= []).push(settlement);
  }

  /** A loan with its rates and payments. */
  loan(budget: Budget, loan: Loan): Loan {
    this.item(
      `loan ${budget.userId} ${loan.id}`,
      () => budget.loans,
      loan.id,
      (item, sort) => loanRows(budget.userId, item, sort),
    );
    return loan;
  }

  addLoan(budget: Budget, loan: Loan): void {
    this.loan(budget, loan);
    budget.loans.push(loan);
  }

  /** A reimbursement claim with its receipts. */
  reimbursement(budget: Budget, claim: Reimbursement): Reimbursement {
    this.item(
      `reimbursement ${budget.userId} ${claim.id}`,
      () => budget.reimbursements,
      claim.id,
      (item, sort) => reimbursementRows(budget.userId, item, sort),
    );
    return claim;
  }

  addReimbursement(budget: Budget, claim: Reimbursement): void {
    this.reimbursement(budget, claim);
    budget.reimbursements.push(claim);
  }

  /** The shared categories, which the caller changes, adds, or removes. */
  sharedCategories(): SharedCategory[] {
    this.touchFacts();
    this.touch("shared categories", () =>
      sharedCategoryRows(this.state.sharedCategories),
    );
    return this.state.sharedCategories;
  }

  /** The opening shared balances, to which the caller adds. */
  openingObligations(): Obligation[] {
    this.touch("opening obligations", () =>
      openingObligationRows(this.state.obligations),
    );
    return this.state.obligations;
  }

  /** A settlement with its allocations. */
  settlement(settlement: Settlement): Settlement {
    this.touchFacts();
    this.item(
      `settlement ${settlement.id}`,
      () => this.state.settlements,
      settlement.id,
      (item, sort) => settlementRows(item, sort),
    );
    return settlement;
  }

  addSettlement(settlement: Settlement): void {
    this.settlement(settlement);
    this.state.settlements.push(settlement);
  }

  /** Every row the touched entities changed, with its prior content. */
  changeSet(operationId: string): ChangeSet {
    const changeSet: ChangeSet = {
      operationId,
      revision: 0,
      after: [],
      before: [],
    };
    const add = (before: WireRow[], after: WireRow[]) => {
      const changes = diffRows(before, after);
      changeSet.before.push(...changes.before);
      changeSet.after.push(...changes.after);
    };
    for (const [key, rows] of this.parts) add(this.before.get(key)!, rows());
    const state = this.state;
    if (!isPersonalLedger(state))
      for (const [viewerId, before] of this.facts)
        add(before, partnerFactRows(state, viewerId));
    return changeSet;
  }
}
