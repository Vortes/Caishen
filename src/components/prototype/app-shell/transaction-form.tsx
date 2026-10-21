"use client";

import { CircleAlertIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { isTransfer, transferNeedsCategory } from "~/domain/transfers";
import { today } from "~/components/budget/format";
import {
  READY_TO_ASSIGN,
  paymentPayees,
} from "~/components/transactions/transaction-draft";
import { Button } from "~/components/ui/button";
import { DateField, type DateFieldHandle } from "./transaction-date";
import { useTransactionEntry, type DraftField } from "./transaction-entry";
import {
  ChoiceField,
  PayeeField,
  type ChoiceOption,
} from "./transaction-fields";
import shell from "./shell.module.css";
import styles from "./transaction-entry.module.css";

// The open editor: a row in the register, under its column headers.
// accountColumn is whether the register shows accounts.
export function TransactionEditor({
  accountColumn = false,
}: {
  accountColumn?: boolean;
}) {
  const { session } = useTransactionEntry();
  if (!session) return null;
  return <TransactionForm key={session.key} accountColumn={accountColumn} />;
}

type Control = DraftField | "error";

function TransactionForm({ accountColumn }: { accountColumn: boolean }) {
  const entry = useTransactionEntry();
  const session = entry.session!;
  const { view, submitting, removed } = entry;
  const { draft, fields, initial } = session;
  const editing = Boolean(session.rowId);
  const formId = useId();
  const controls = useRef<Partial<Record<Control, HTMLElement | null>>>({});
  const dateField = useRef<DateFieldHandle>(null);
  const register = (name: Control) => (element: HTMLElement | null) => {
    controls.current[name] = element;
  };

  // Takes the controller's pending focus move once this editor is on screen.
  // Opening focuses a text field only with a mouse or trackpad, so a touch
  // keyboard doesn't cover the form before it's read. The calendar has no
  // keyboard, so it takes focus everywhere.
  useEffect(() => {
    const request = entry.takeFocus();
    if (!request) return;
    if (request.target === "calendar") {
      dateField.current?.focusCalendar();
      return;
    }
    if (request.auto && !window.matchMedia("(pointer: fine)").matches) return;
    const element = controls.current[request.target];
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  });

  const account = view.accounts.find((item) => item.id === draft.accountId);
  const destinations = paymentPayees(view, draft);
  const destination = destinations.find((item) =>
    item.accountId
      ? item.accountId === draft.transferAccountId
      : item.loanId === draft.loanId,
  );
  const loan = view.budget.loans.find((item) => item.id === draft.loanId);
  const other = view.accounts.find(
    (item) => item.id === draft.transferAccountId,
  );
  const boundary = Boolean(
    account && other && transferNeedsCategory(account, other),
  );
  const categoryNotNeeded =
    Boolean(other && !boundary) || (account?.kind === "tracking" && !other);
  const budgetInflow =
    account?.kind === "tracking"
      ? Boolean(draft.outflow)
      : Boolean(draft.inflow);
  const shared = view.sharedCategories.find(
    (item) => item.id === draft.sharedCategoryId,
  );
  const accountOptions = useMemo<ChoiceOption[]>(
    () =>
      view.accounts.map((item) => ({
        value: item.id,
        label: item.name,
        group:
          item.kind === "credit"
            ? "Credit"
            : item.kind === "tracking"
              ? "Tracking"
              : "Cash",
      })),
    [view.accounts],
  );
  const categoryOptions: ChoiceOption[] = [
    {
      value: READY_TO_ASSIGN,
      label: "Ready to Assign",
      group: "Inflow",
      amount: view.readyToAssign,
      disabled:
        (boundary ? !budgetInflow : account?.kind === "credit") ||
        (Boolean(initial?.categoryId) &&
          !boundary &&
          initial !== undefined &&
          !isTransfer(initial) &&
          initial?.kind !== "loan-payment") ||
        Boolean(shared),
    },
    ...view.categories
      .filter(
        (category) =>
          !category.pairedAccountId &&
          (loan ? category.pairedLoanId === loan.id : !category.pairedLoanId) &&
          (!shared || shared.categoryIds[view.budget.userId] === category.id),
      )
      .map((category) => ({
        value: category.id,
        label: category.name,
        group: category.group,
        amount: category.available,
      })),
  ];
  const payees = useMemo(
    () => [
      ...new Set(
        view.budget.transactions
          .filter(
            (item) =>
              !item.removed &&
              ["purchase", "refund", "income"].includes(item.kind),
          )
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((item) => item.payee),
      ),
    ],
    [view.budget.transactions],
  );
  const startDate = `${view.budget.startMonth}-01`;
  const minDate =
    account && account.date > startDate ? account.date : startDate;

  const id = (field: DraftField) => `${formId}-${field}`;
  // One message about both amounts shows once, across their two columns.
  const amountError =
    fields.outflow && fields.outflow === fields.inflow ? fields.outflow : "";
  const amountErrorId = `${formId}-amount-error`;
  const shownOnce = (field: DraftField) =>
    Boolean(amountError) && (field === "outflow" || field === "inflow");
  const described = (field: DraftField) =>
    shownOnce(field)
      ? amountErrorId
      : fields[field]
        ? `${id(field)}-error`
        : undefined;
  const fieldError = (name: DraftField) =>
    !shownOnce(name) &&
    fields[name] && (
      <p id={`${id(name)}-error`} className={styles.fieldError}>
        <CircleAlertIcon size={13} aria-hidden />
        {fields[name]}
      </p>
    );
  // A field in the register row, under its column. The column header names
  // it on screen; the label stays for screen readers, and shows on a phone
  // where the row stacks.
  const cell = (
    name: DraftField,
    column: string,
    label: string,
    control: ReactNode,
  ) => (
    <div className={styles.cell} data-column={column}>
      <label htmlFor={id(name)} className={styles.cellLabel}>
        {label}
      </label>
      {control}
      {fieldError(name)}
    </div>
  );
  const amount = (name: "outflow" | "inflow") => (
    <div
      className={styles.well}
      data-invalid={fields[name] ? "" : undefined}
      data-amount
    >
      <span className={styles.prefix} aria-hidden>
        $
      </span>
      <input
        ref={register(name)}
        id={id(name)}
        name={name}
        className={styles.input}
        inputMode="decimal"
        placeholder={name === "outflow" ? "Outflow" : "Inflow"}
        autoComplete="off"
        spellCheck={false}
        readOnly={submitting}
        aria-invalid={Boolean(fields[name]) || undefined}
        aria-describedby={described(name)}
        value={draft[name]}
        onChange={(event) => {
          const value = event.target.value;
          // Outflow and inflow are one amount: typing in one clears the other.
          entry.change({
            [name]: value,
            ...(name === "outflow" && value.trim() ? { inflow: "" } : {}),
            ...(name === "inflow" && value.trim() ? { outflow: "" } : {}),
          });
        }}
      />
    </div>
  );
  // Taking a choice moves on to the next field, which opens its own list.
  // Touch keeps focus where it is, so a keyboard doesn't open over the form.
  const advance = (to: DraftField) => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    controls.current[to]?.focus({ preventScroll: true });
  };
  const todayKey = today(view.budget.settings.timezone);
  const dateControl = (
    <DateField
      handle={dateField}
      id={id("date")}
      label="Date"
      value={draft.date}
      min={minDate}
      // Activity is recorded once it happened, so no later day can be picked.
      max={todayKey}
      today={todayKey}
      open={session.calendarOpen}
      inputRef={register("date")}
      invalid={Boolean(fields.date)}
      describedBy={described("date")}
      readOnly={submitting}
      onOpenChange={entry.setCalendarOpen}
      onChange={(date) => entry.change({ date })}
      onPicked={() => advance("payee")}
      onAdvance={() => controls.current.payee?.focus({ preventScroll: true })}
    />
  );
  const payeeControl = (
    <PayeeField
      id={id("payee")}
      label="Payee"
      value={destination?.label ?? draft.payee}
      payees={payees}
      destinations={destinations}
      selectedDestination={destination?.value}
      onDestination={(value) => {
        const selected = destinations.find((item) => item.value === value);
        if (!selected) return;
        entry.change({
          payee: selected.label,
          transferAccountId: selected.accountId,
          loanId: selected.loanId,
          ...(selected.loanId !== draft.loanId ? { interest: "" } : {}),
          categoryId: selected.loanId
            ? view.budget.loans.find((item) => item.id === selected.loanId)!
                .categoryId
            : account &&
                selected.accountId &&
                transferNeedsCategory(
                  account,
                  view.accounts.find((item) => item.id === selected.accountId)!,
                )
              ? draft.categoryId || (budgetInflow ? READY_TO_ASSIGN : "")
              : "",
        });
      }}
      placeholder="Payee"
      inputRef={register("payee")}
      invalid={Boolean(fields.payee)}
      describedBy={described("payee")}
      readOnly={submitting}
      onChange={(payee) =>
        entry.change({
          payee,
          transferAccountId: "",
          loanId: "",
          ...(draft.loanId ? { categoryId: "" } : {}),
        })
      }
      onPicked={(value) => {
        const selected = destinations.find((item) => item.value === value);
        if (
          selected?.accountId &&
          account &&
          !transferNeedsCategory(
            account,
            view.accounts.find((item) => item.id === selected.accountId)!,
          )
        )
          advance(selected.label.includes(" from ") ? "inflow" : "outflow");
        else if (!selected && categoryNotNeeded) advance("outflow");
        else advance("categoryId");
      }}
    />
  );
  const categoryControl = categoryNotNeeded ? (
    <div className={styles.well} data-disabled>
      <input
        id={id("categoryId")}
        className={styles.input}
        aria-label="Category"
        value="Category not needed"
        disabled
      />
    </div>
  ) : (
    <ChoiceField
      id={id("categoryId")}
      label="Category"
      value={draft.categoryId}
      options={categoryOptions}
      placeholder="Category"
      inputRef={register("categoryId")}
      invalid={Boolean(fields.categoryId)}
      describedBy={described("categoryId")}
      readOnly={submitting}
      onChange={(categoryId) => entry.change({ categoryId })}
      // Ready to Assign only takes an inflow.
      onPicked={(categoryId) =>
        advance(
          categoryId === READY_TO_ASSIGN
            ? account?.kind === "tracking" && boundary
              ? "outflow"
              : "inflow"
            : account?.kind === "tracking" && boundary && draft.inflow
              ? "inflow"
              : "outflow",
        )
      }
    />
  );
  const accountControl = (
    <ChoiceField
      id={id("accountId")}
      label="Account"
      value={draft.accountId}
      options={accountOptions}
      placeholder="Account"
      inputRef={register("accountId")}
      invalid={Boolean(fields.accountId)}
      describedBy={described("accountId")}
      disabled={editing}
      readOnly={submitting}
      onChange={(accountId) =>
        entry.change({
          accountId,
          transferAccountId: "",
          loanId: "",
          payee: destination ? "" : draft.payee,
        })
      }
      onPicked={() => {
        if (!window.matchMedia("(pointer: fine)").matches) return;
        entry.setCalendarOpen(true);
        dateField.current?.focusCalendar();
      }}
    />
  );
  const notice = removed && (
    <p className={styles.notice} role="alert">
      This transaction was deleted in another session, so these changes can’t be
      saved. Cancel to close the editor.
    </p>
  );
  const error = session.error && (
    <p
      ref={register("error")}
      tabIndex={-1}
      className={styles.formError}
      role="status"
    >
      <CircleAlertIcon size={13} aria-hidden />
      {session.error}
    </p>
  );
  const actions = (
    <div className={styles.actions}>
      <Button size="sm" disabled={submitting} onClick={entry.cancel}>
        Cancel
      </Button>
      {!editing && (
        <Button
          size="sm"
          disabled={removed || submitting}
          onClick={() => void entry.submit(true)}
        >
          Save and add another
        </Button>
      )}
      <Button
        variant="primary"
        size="sm"
        type="submit"
        disabled={removed || submitting}
      >
        {submitting ? "Saving…" : "Save"}
      </Button>
    </div>
  );

  const title = editing ? "Edit transaction" : "New transaction";
  return (
    <form
      id={formId}
      className={styles.form}
      aria-labelledby={`${formId}-title`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void entry.submit(false);
      }}
      onKeyDown={(event) => {
        // The register moves its selection with the arrow keys; inside the
        // editor they belong to the fields.
        if (event.key === "ArrowDown" || event.key === "ArrowUp")
          event.stopPropagation();
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (event.defaultPrevented || submitting) return;
        event.preventDefault();
        entry.cancel();
      }}
    >
      <h2 id={`${formId}-title`} className="sr-only">
        {title}
      </h2>
      {notice}
      <div
        className={`${shell.txColumns} ${styles.entryRow}`}
        data-accounts={accountColumn || undefined}
      >
        {accountColumn &&
          cell("accountId", "account", "Account", accountControl)}
        {cell("date", "date", "Date", dateControl)}
        {cell("payee", "payee", "Payee", payeeControl)}
        {cell("categoryId", "category", "Category", categoryControl)}
        {cell("outflow", "outflow", "Outflow", amount("outflow"))}
        {cell("inflow", "inflow", "Inflow", amount("inflow"))}
        <span data-column="status" aria-hidden />
        {amountError && (
          <p id={amountErrorId} className={styles.amountError}>
            <CircleAlertIcon size={13} aria-hidden />
            {amountError}
          </p>
        )}
      </div>
      {loan && (
        <div className={styles.loanDetails}>
          <div>
            <label htmlFor={id("interest")}>Lender-confirmed interest</label>
            <div
              className={styles.well}
              data-invalid={Boolean(fields.interest) || undefined}
            >
              <span aria-hidden>$</span>
              <input
                ref={register("interest")}
                id={id("interest")}
                className={styles.input}
                inputMode="decimal"
                value={draft.interest}
                placeholder="0.00"
                readOnly={submitting}
                aria-invalid={Boolean(fields.interest) || undefined}
                aria-describedby={described("interest")}
                onChange={(event) =>
                  entry.change({ interest: event.target.value })
                }
              />
            </div>
            {fieldError("interest")}
          </div>
          <p>
            The outflow includes principal and interest. Only principal reduces
            the loan balance.
          </p>
        </div>
      )}
      <div className={styles.rowFooter}>
        {error}
        {actions}
      </div>
    </form>
  );
}
