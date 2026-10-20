"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";

import { BankImportReview } from "~/components/banks/bank-import-review";
import { newId } from "~/components/budget/format";
import type { Panel, State, View } from "~/components/budget/types";
import { Amount, EmptyState, Icon } from "~/components/shared";
import { CategorySuggestions } from "~/components/transactions/category-suggestions";
import { RegisterActionsMenu } from "~/components/transactions/register-actions-menu";
import { RegisterHeader } from "~/components/transactions/register-header";
import { TransactionRow } from "~/components/transactions/transaction-row";
import { BankImportRow } from "~/components/transactions/bank-import-row";
import { TransactionEditor } from "~/components/transactions/transaction-editor";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import type { Command } from "~/domain/engine";
import { bankImportNeedsReview } from "~/lib/bank-import-review";

type RegisterRow =
  | {
      kind: "transaction";
      id: string;
      date: string;
      transaction: View["budget"]["transactions"][number];
    }
  | {
      kind: "import";
      id: string;
      date: string;
      item: State["imports"][number];
    };

function importRowId(item: State["imports"][number]) {
  return `bank:${JSON.stringify([item.connectionId, item.logicalId])}`;
}

export function TransactionRegister({
  state,
  month,
  accountId,
  reviewOnly,
  onReviewOnlyChange,
  busy,
  run,
  open,
  editor,
  onStartTransaction,
  onCloseTransaction,
  onSaveTransaction,
}: {
  state: State;
  month: string;
  accountId: string | null;
  reviewOnly: boolean;
  onReviewOnlyChange: (value: boolean) => void;
  busy: boolean;
  run: (command: Command) => void;
  open: (panel: Panel) => void;
  editor: { key: string; transactionId?: string } | null;
  onStartTransaction: (transactionId?: string) => void;
  onCloseTransaction: () => void;
  onSaveTransaction: (command: Command) => Promise<void>;
}) {
  const view = state.view!;
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [activeImportId, setActiveImportId] = useState<string | null>(null);
  const reviewOpenerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(34);
  const [editorHeight, setEditorHeight] = useState(0);
  const rowStartOffset = headerHeight + editorHeight;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const editorBodyRef = useRef<HTMLTableSectionElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const editorOpenerRef = useRef<HTMLElement | null>(null);
  const previousEditorRef = useRef(editor);
  const footerRef = useRef<HTMLElement>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const accountById = useMemo(
    () => new Map(view.accounts.map((item) => [item.id, item])),
    [view.accounts],
  );
  const categoryById = useMemo(
    () => new Map(view.categories.map((item) => [item.id, item])),
    [view.categories],
  );
  const account = accountId ? accountById.get(accountId) : undefined;
  const accounts = accountId ? (account ? [account] : []) : view.accounts;
  const balance = accounts.reduce((total, item) => total + item.balance, 0);
  const cards = accounts.filter((item) => item.kind === "credit");
  const accountTransactions = useMemo(
    () =>
      view.budget.transactions.filter(
        (transaction) =>
          !transaction.removed &&
          (!accountId || transaction.accountId === accountId),
      ),
    [view.budget.transactions, accountId],
  );
  const reviewCount = accountTransactions.filter(
    (transaction) => !transaction.reviewed,
  ).length;
  const pendingOutflows = accountTransactions.reduce(
    (total, transaction) =>
      transaction.status === "pending" &&
      transaction.amount < 0 &&
      transaction.date <= `${month}-31`
        ? total + transaction.amount
        : total,
    0,
  );
  const imports = useMemo(
    () =>
      accountId
        ? state.imports.filter((item) => item.accountId === accountId)
        : state.imports,
    [accountId, state.imports],
  );
  const activeImport = state.imports.find(
    (item) => importRowId(item) === activeImportId,
  );
  const inboxCount = reviewCount + imports.filter(bankImportNeedsReview).length;
  const query = search.trim().toLowerCase();
  const transactions = useMemo(
    () =>
      accountTransactions.filter(
        (transaction) =>
          (reviewOnly
            ? !transaction.reviewed
            : transaction.date <= `${month}-31`) &&
          transaction.payee.toLowerCase().includes(query),
      ),
    [accountTransactions, reviewOnly, month, query],
  );
  const rows = useMemo(() => {
    const rows: RegisterRow[] = transactions.map((transaction) => ({
      kind: "transaction",
      id: transaction.id,
      date: transaction.date,
      transaction,
    }));
    for (const item of imports) {
      if (
        (reviewOnly
          ? bankImportNeedsReview(item)
          : item.date <= `${month}-31`) &&
        item.payee.toLowerCase().includes(query)
      ) {
        rows.push({
          kind: "import",
          id: importRowId(item),
          date: item.date,
          item,
        });
      }
    }
    return rows.sort(
      (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    );
  }, [transactions, imports, reviewOnly, month, query]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const { selected, selectedForApproval, selectedAmount } = useMemo(() => {
    const selected: string[] = [];
    const selectedForApproval: string[] = [];
    let selectedAmount = 0;
    for (const transaction of transactions) {
      if (!selectedIdSet.has(transaction.id)) continue;
      selected.push(transaction.id);
      if (!transaction.reviewed) selectedForApproval.push(transaction.id);
      selectedAmount += transaction.amount;
    }
    return { selected, selectedForApproval, selectedAmount };
  }, [transactions, selectedIdSet]);
  const allSelected =
    transactions.length > 0 && selected.length === transactions.length;
  const indexById = useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
    [rows],
  );
  const focusedIndex = focusedId ? indexById.get(focusedId) : undefined;
  const activeImportIndex = activeImportId
    ? indexById.get(activeImportId)
    : undefined;
  const virtualized = rows.length > 100;
  const getItemKey = useCallback((index: number) => rows[index]!.id, [rows]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      for (const pinnedIndex of [focusedIndex, activeImportIndex]) {
        if (pinnedIndex === undefined) continue;
        for (
          let index = Math.max(0, pinnedIndex - 1);
          index <= Math.min(range.count - 1, pinnedIndex + 1);
          index++
        ) {
          indexes.push(index);
        }
      }
      return [...new Set(indexes)].sort((a, b) => a - b);
    },
    [focusedIndex, activeImportIndex],
  );
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: rows.length,
    enabled: virtualized,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => 40,
    overscan: 8,
    rangeExtractor,
    scrollMargin: rowStartOffset,
    scrollPaddingStart: headerHeight,
    measureElement: (element) => element.getBoundingClientRect().height,
  });
  const virtualRows = virtualizer.getVirtualItems();
  useEffect(() => {
    if (!virtualized || !headerRef.current) return;
    const header = headerRef.current;
    const measure = () => {
      setHeaderHeight(header.getBoundingClientRect().height);
      setEditorHeight(
        editorBodyRef.current?.getBoundingClientRect().height ?? 0,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (editorBodyRef.current) observer.observe(editorBodyRef.current);
    return () => observer.disconnect();
  }, [virtualized, editor?.key]);
  useEffect(() => {
    if (editor) scrollRef.current?.scrollTo({ top: 0 });
    else if (previousEditorRef.current) {
      const opener = editorOpenerRef.current;
      (opener?.isConnected ? opener : addButtonRef.current)?.focus({
        preventScroll: true,
      });
    }
    previousEditorRef.current = editor;
  }, [editor]);
  const startEditor = (id?: string) => {
    editorOpenerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    onStartTransaction(id);
  };
  const editorTransaction = editor?.transactionId
    ? view.budget.transactions.find(
        (item) => item.id === editor.transactionId && !item.removed,
      )
    : undefined;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, accountId, reviewOnly, month]);
  const selectTransaction = (id: string, checked: boolean) => {
    setSelectedIds(
      checked ? [...selected, id] : selected.filter((item) => item !== id),
    );
  };
  const renderRow = (index: number) => {
    const row = rows[index]!;
    if (row.kind === "import") {
      return (
        <BankImportRow
          key={row.id}
          id={row.id}
          item={row.item}
          index={index}
          rowOffset={editor ? 2 : 0}
          accountName={
            row.item.accountId
              ? accountById.get(row.item.accountId)?.name
              : undefined
          }
          showAccount={!accountId}
          rowRef={virtualized ? virtualizer.measureElement : undefined}
          onReview={() => {
            reviewOpenerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            setActiveImportId(row.id);
          }}
        />
      );
    }
    const transaction = row.transaction;
    return (
      <TransactionRow
        key={transaction.id}
        transaction={transaction}
        index={index}
        rowOffset={editor ? 2 : 0}
        accountName={accountById.get(transaction.accountId)?.name}
        categoryName={
          transaction.categoryId
            ? categoryById.get(transaction.categoryId)?.name
            : undefined
        }
        showAccount={!accountId}
        selected={selectedIdSet.has(transaction.id)}
        busy={busy}
        rowRef={virtualized ? virtualizer.measureElement : undefined}
        onSelect={selectTransaction}
        open={open}
        onEdit={startEditor}
      />
    );
  };
  const columnCount = accountId ? 7 : 8;
  let previousEnd = rowStartOffset;
  const renderedRows = virtualized
    ? virtualRows.map((row) => {
        const gap = Math.max(0, row.start - previousEnd);
        previousEnd = row.end;
        return (
          <Fragment key={row.key}>
            {gap > 0 && <RegisterSpacer height={gap} columns={columnCount} />}
            {renderRow(row.index)}
          </Fragment>
        );
      })
    : rows.map((_, index) => renderRow(index));
  const bottomGap = virtualized
    ? Math.max(0, virtualizer.getTotalSize() - (previousEnd - rowStartOffset))
    : 0;

  return (
    <section className="transaction-register" aria-label="Transaction register">
      {!reviewOnly && inboxCount > 0 && (
        <div className="review-banner">
          <Icon name="info" size={15} />
          <span>
            {inboxCount} {inboxCount === 1 ? "item needs" : "items need"} your
            review.
          </span>
          <Button size="sm" onClick={() => onReviewOnlyChange(true)}>
            View
          </Button>
        </div>
      )}
      <RegisterHeader
        title={account?.name ?? "All accounts"}
        month={month}
        postedBalance={balance - pendingOutflows}
        pendingOutflows={pendingOutflows}
        workingBalance={balance}
        credit={
          account?.kind === "credit"
            ? { reserve: account.reserve, shortfall: account.shortfall }
            : undefined
        }
      />

      <div className="register-toolbar">
        <Button
          variant="ghost"
          size="sm"
          className="register-add-transaction"
          ref={addButtonRef}
          onClick={() => startEditor()}
          disabled={busy || Boolean(editor) || !view.accounts.length}
        >
          <Icon name="plus" size={15} />
          Add transaction
        </Button>
        <RegisterActionsMenu
          accountId={account?.id}
          hasCreditAccounts={cards.length > 0}
          disabled={busy || !view.accounts.length}
          onAction={open}
        />
        {selected.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={
              busy ||
              !selectedForApproval.length ||
              selectedForApproval.length > 500
            }
            title={
              selectedForApproval.length > 500
                ? "Approve up to 500 transactions at a time"
                : undefined
            }
            onClick={() =>
              run({
                type: "transaction.approve",
                id: newId(),
                transactionIds: selectedForApproval,
              })
            }
          >
            Approve{" "}
            {selectedForApproval.length
              ? `(${selectedForApproval.length})`
              : "selected"}
          </Button>
        )}
        <div className="register-view-controls">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={viewTriggerRef}
                variant="ghost"
                size="sm"
                aria-label="View transactions"
              >
                View
                <Icon name="chevron-down" size={12} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={reviewOnly ? "review" : "all"}
                onValueChange={(value) =>
                  onReviewOnlyChange(value === "review")
                }
              >
                <DropdownMenuRadioItem value="all">
                  All transactions
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="review">
                  Needs review ({inboxCount})
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {reviewOnly && (
            <Button
              variant="secondary"
              size="sm"
              className="register-review-filter"
              onClick={() => {
                onReviewOnlyChange(false);
                viewTriggerRef.current?.focus({ preventScroll: true });
              }}
              aria-label="Clear review filter"
            >
              Needs review
              <Icon name="close" size={12} />
            </Button>
          )}
          <div className="register-search">
            <Icon name="search" size={16} />
            <Input
              type="search"
              aria-label="Search transactions by payee"
              placeholder="Search transactions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </div>

      {reviewOnly && (
        <div className="register-review-notice" role="status">
          Showing transactions awaiting review across all months.
        </div>
      )}

      <div
        ref={scrollRef}
        className="register-table-scroll relative"
        role="region"
        aria-label="Transactions"
        tabIndex={0}
        data-virtualized={virtualized || undefined}
        onKeyDown={(event) => {
          if (!virtualized || event.target !== event.currentTarget) return;
          if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            virtualizer.scrollToIndex(
              event.key === "Home" ? 0 : rows.length - 1,
              { align: event.key === "Home" ? "start" : "end" },
            );
          }
        }}
        onFocusCapture={(event) => {
          const row = event.target.closest<HTMLTableRowElement>(
            "tr[data-transaction-id]",
          );
          if (!row) {
            setFocusedId(null);
            return;
          }
          const id = row.dataset.transactionId!;
          setFocusedId(id);
          const index = indexById.get(id);
          if (virtualized && index !== undefined)
            virtualizer.scrollToIndex(index, { align: "auto" });
        }}
        onBlurCapture={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setFocusedId(null);
          }
        }}
      >
        {virtualized && (
          <button
            type="button"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10"
            onClick={() => footerRef.current?.focus()}
          >
            Skip transaction rows
          </button>
        )}
        <table
          className="register-table"
          aria-rowcount={rows.length + 1 + (editor ? 2 : 0)}
        >
          <colgroup>
            <col className="register-select-column" />
            {!accountId && <col className="register-account-column" />}
            <col className="register-date-column" />
            <col className="register-payee-column" />
            <col className="register-category-column" />
            <col className="register-amount-column" />
            <col className="register-amount-column" />
            <col className="register-status-column" />
          </colgroup>
          <caption className="sr-only">
            {reviewOnly ? "Transactions awaiting review" : "All transactions"}
            {account ? ` for ${account.name}` : " for all accounts"}
          </caption>
          <thead ref={headerRef}>
            <tr aria-rowindex={1}>
              <th scope="col" className="register-select-cell">
                <Checkbox
                  aria-label="Select all visible transactions"
                  title="Select recorded transactions. Review bank imports individually."
                  checked={
                    allSelected
                      ? true
                      : selected.length
                        ? "indeterminate"
                        : false
                  }
                  disabled={!transactions.length}
                  onCheckedChange={(checked) =>
                    setSelectedIds(
                      checked
                        ? transactions.map((transaction) => transaction.id)
                        : [],
                    )
                  }
                />
              </th>
              {!accountId && <th scope="col">Account</th>}
              <th scope="col" aria-sort="descending">
                Date
              </th>
              <th scope="col">Payee</th>
              <th scope="col">Category</th>
              <th scope="col" className="number">
                Outflow
              </th>
              <th scope="col" className="number">
                Inflow
              </th>
              <th scope="col" className="register-status-heading">
                <span className="sr-only">Review and bank status</span>
                <Icon name="check" size={13} />
              </th>
            </tr>
          </thead>
          {editor && (
            <tbody ref={editorBodyRef} className="transaction-editor-body">
              {editor.transactionId && !editorTransaction ? (
                <tr>
                  <td colSpan={columnCount}>
                    <p role="alert">This transaction is no longer available.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onCloseTransaction}
                    >
                      Close editor
                    </Button>
                  </td>
                </tr>
              ) : (
                <TransactionEditor
                  key={editor.key}
                  view={view}
                  month={month}
                  transaction={editorTransaction}
                  defaultAccountId={account?.id}
                  showAccount={!accountId}
                  busy={busy}
                  onSave={onSaveTransaction}
                  onClose={onCloseTransaction}
                />
              )}
            </tbody>
          )}
          <tbody>
            {renderedRows}
            {bottomGap > 0 && (
              <RegisterSpacer height={bottomGap} columns={columnCount} />
            )}
          </tbody>
        </table>
        {!rows.length && !editor && (
          <EmptyState
            icon={reviewOnly ? "check" : "transactions"}
            title={
              search
                ? "No matching transactions"
                : reviewOnly
                  ? "You’re all caught up"
                  : "No transactions yet"
            }
            action={
              !reviewOnly && !search && view.accounts.length ? (
                <Button size="sm" onClick={() => startEditor()}>
                  Add transaction
                </Button>
              ) : undefined
            }
          >
            {search
              ? "Try another payee name."
              : reviewOnly
                ? "Transactions that need your attention will appear here."
                : "Add a purchase or income to start your account register."}
          </EmptyState>
        )}
      </div>

      <footer
        ref={footerRef}
        tabIndex={-1}
        className="register-footer"
        aria-live="polite"
      >
        <span>
          {rows.length} {rows.length === 1 ? "transaction" : "transactions"}
        </span>
        {selected.length > 0 && (
          <span className="register-selection-summary">
            {selected.length} selected <span aria-hidden="true">·</span>{" "}
            <Amount value={selectedAmount} signed />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds([])}
            >
              Clear selection
            </Button>
          </span>
        )}
      </footer>

      <Dialog
        open={Boolean(activeImport)}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setFocusedId(activeImportId);
            setActiveImportId(null);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = reviewOpenerRef.current;
            (opener?.isConnected ? opener : footerRef.current)?.focus({
              preventScroll: true,
            });
          }}
          onOpenAutoFocus={(event) => {
            if (window.matchMedia("(pointer: coarse)").matches) {
              event.preventDefault();
              if (event.target instanceof HTMLElement) event.target.focus();
            }
          }}
        >
          {activeImport && (
            <>
              <DialogHeader>
                <DialogTitle>Review {activeImport.payee}</DialogTitle>
                <DialogDescription>
                  {activeImport.date} ·{" "}
                  {activeImport.pending ? "Pending" : "Posted"} ·{" "}
                  <Amount value={activeImport.amount} signed />
                  {activeImport.accountId &&
                    ` · ${accountById.get(activeImport.accountId)?.name ?? "Account"}`}
                </DialogDescription>
              </DialogHeader>
              <BankImportReview
                key={activeImportId}
                state={state}
                item={activeImport}
                onResolved={() =>
                  setActiveImportId((current) =>
                    current === importRowId(activeImport) ? null : current,
                  )
                }
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      <details className="register-suggestions">
        <summary>Category suggestions</summary>
        <CategorySuggestions
          state={state}
          selected={selected}
          run={run}
          busy={busy}
        />
      </details>
    </section>
  );
}

function RegisterSpacer({
  height,
  columns,
}: {
  height: number;
  columns: number;
}) {
  return (
    <tr aria-hidden="true" data-virtual-spacer="" style={{ height }}>
      <td
        colSpan={columns}
        style={{ height, padding: 0, border: 0, lineHeight: 0 }}
      />
    </tr>
  );
}
