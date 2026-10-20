"use client";

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  PencilIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { formatMoney } from "~/components/budget/format";
import {
  READY_TO_ASSIGN,
  type TransactionDraft,
} from "~/components/transactions/transaction-draft";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Tooltip } from "~/components/ui/tooltip";
import {
  editGuidance,
  useTransactionEntry,
  type DraftField,
  type TransactionPlacement,
} from "./transaction-entry";
import {
  ChoiceField,
  PayeeField,
  type ChoiceOption,
} from "./transaction-fields";
import shell from "./shell.module.css";
import styles from "./transaction-entry.module.css";

// The open editor in one placement: a row in the register, or a card in the
// details panel. Both show the same draft, so switching keeps it.
export function TransactionEditor({
  placement,
}: {
  placement: TransactionPlacement;
}) {
  const { session } = useTransactionEntry();
  if (!session) return null;
  return placement === "register" ? (
    <div className={styles.rowEditor}>
      <TransactionForm key={session.key} placement={placement} />
    </div>
  ) : (
    <Card>
      <TransactionForm key={session.key} placement={placement} />
    </Card>
  );
}

// The Edit action on a selected transaction, or why it isn't edited here.
export function TransactionEditAction({
  transactionId,
}: {
  transactionId: string;
}) {
  const entry = useTransactionEntry();
  const transaction = entry.view.budget.transactions.find(
    (item) => item.id === transactionId && !item.removed,
  );
  if (!transaction) return null;
  const guidance = editGuidance(transaction);
  if (guidance) return <p className={styles.guidance}>{guidance}</p>;
  return (
    <div className={shell.cardActions}>
      <Tooltip label="Edit this transaction" shortcut="E">
        <Button
          data-transaction-opener={transaction.id}
          disabled={Boolean(entry.session) || entry.busy}
          onClick={() => entry.start({ transactionId: transaction.id })}
        >
          <PencilIcon aria-hidden />
          Edit
        </Button>
      </Tooltip>
    </div>
  );
}

type Control = DraftField | "placement" | "error";

function TransactionForm({ placement }: { placement: TransactionPlacement }) {
  const entry = useTransactionEntry();
  const session = entry.session!;
  const { view, submitting, removed } = entry;
  const { draft, fields, initial } = session;
  const editing = Boolean(initial);
  const formId = useId();
  const controls = useRef<Partial<Record<Control, HTMLElement | null>>>({});
  const register = (name: Control) => (element: HTMLElement | null) => {
    controls.current[name] = element;
  };

  // Takes the controller's pending focus move once this editor is on screen.
  // Opening focuses the first field only with a mouse or trackpad, so a
  // touch keyboard doesn't cover the form before it's read.
  useEffect(() => {
    const request = entry.takeFocus();
    if (!request) return;
    if (request.auto && !window.matchMedia("(pointer: fine)").matches) return;
    let element = controls.current[request.target];
    if (request.target === "placement")
      element =
        element?.querySelector<HTMLElement>('[aria-checked="true"]') ?? element;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "nearest" });
  });

  const account = view.accounts.find((item) => item.id === draft.accountId);
  const shared = view.sharedCategories.find(
    (item) => item.id === draft.sharedCategoryId,
  );
  const accountOptions = useMemo<ChoiceOption[]>(
    () =>
      view.accounts.map((item) => ({
        value: item.id,
        label: item.name,
        group: item.kind === "credit" ? "Credit" : "Cash",
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
        account?.kind === "credit" ||
        Boolean(initial?.categoryId) ||
        Boolean(shared),
    },
    ...view.categories
      .filter(
        (category) =>
          !category.pairedAccountId &&
          !category.pairedLoanId &&
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
          .filter((item) => !item.removed)
          .map((item) => item.payee),
      ),
    ],
    [view.budget.transactions],
  );

  const id = (field: DraftField) => `${formId}-${field}`;
  const described = (field: DraftField, hint?: boolean) =>
    [
      fields[field] ? `${id(field)}-error` : null,
      hint ? `${id(field)}-hint` : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const field = (
    name: DraftField,
    label: string,
    control: ReactNode,
    hint?: string,
  ) => (
    <div className={styles.field} data-area={name}>
      <label htmlFor={id(name)} className={styles.label}>
        {label}
      </label>
      {control}
      {fields[name] && (
        <p id={`${id(name)}-error`} className={styles.fieldError}>
          <CircleAlertIcon size={13} aria-hidden />
          {fields[name]}
        </p>
      )}
      {hint && (
        <p id={`${id(name)}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
  const textInput = (
    name: DraftField,
    props: {
      type?: string;
      inputMode?: "decimal";
      placeholder?: string;
      min?: string;
      hint?: boolean;
    } = {},
  ) => (
    <input
      ref={register(name)}
      id={id(name)}
      name={name}
      className={styles.input}
      type={props.type ?? "text"}
      inputMode={props.inputMode}
      placeholder={props.placeholder}
      min={props.min}
      autoComplete="off"
      spellCheck={false}
      readOnly={submitting}
      aria-invalid={Boolean(fields[name]) || undefined}
      aria-describedby={described(name, props.hint)}
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
  );
  const amount = (name: "outflow" | "inflow") => (
    <div className={styles.well} data-invalid={fields[name] ? "" : undefined}>
      <span className={styles.prefix} aria-hidden>
        $
      </span>
      {textInput(name, { inputMode: "decimal", placeholder: "0.00" })}
    </div>
  );
  const select = (
    name: "status" | "sharedCategoryId",
    options: { value: string; label: string; disabled?: boolean }[],
    onChange: (value: string) => void,
    hint?: boolean,
  ) => (
    <div
      className={styles.well}
      data-invalid={fields[name] ? "" : undefined}
      data-select
    >
      <select
        ref={register(name)}
        id={id(name)}
        name={name}
        className={styles.input}
        disabled={submitting}
        aria-invalid={Boolean(fields[name]) || undefined}
        aria-describedby={described(name, hint)}
        value={draft[name]}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={12} className={styles.chevron} aria-hidden />
    </div>
  );

  const detailsId = `${formId}-details`;
  const ownShare = initial?.shares?.[view.budget.userId];
  return (
    <form
      id={formId}
      className={styles.form}
      data-placement={placement}
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
      <div className={styles.header}>
        <h2 id={`${formId}-title`} className={styles.title}>
          {editing ? "Edit transaction" : "New transaction"}
        </h2>
        <div ref={register("placement")}>
          <SegmentedControl
            aria-label="Editor placement"
            value={placement}
            onValueChange={(next) =>
              entry.setPlacement(next as TransactionPlacement)
            }
          >
            <SegmentedControlItem value="register">
              Register row
            </SegmentedControlItem>
            <SegmentedControlItem value="inspector">
              Inspector
            </SegmentedControlItem>
          </SegmentedControl>
        </div>
      </div>

      {removed && (
        <p className={styles.notice} role="alert">
          This transaction was deleted in another session, so these changes
          can’t be saved. Cancel to close the editor.
        </p>
      )}

      <div className={styles.fields} data-placement={placement}>
        {field(
          "date",
          "Date",
          <div
            className={styles.well}
            data-invalid={fields.date ? "" : undefined}
          >
            {textInput("date", {
              type: "date",
              min: account?.date ?? `${view.budget.startMonth}-01`,
            })}
          </div>,
        )}
        {field(
          "payee",
          "Payee",
          <PayeeField
            id={id("payee")}
            label="Payee"
            value={draft.payee}
            payees={payees}
            inputRef={register("payee")}
            invalid={Boolean(fields.payee)}
            describedBy={described("payee")}
            readOnly={submitting}
            onChange={(payee) => entry.change({ payee })}
          />,
        )}
        {field(
          "categoryId",
          "Category",
          <ChoiceField
            id={id("categoryId")}
            label="Category"
            value={draft.categoryId}
            options={categoryOptions}
            placeholder="Choose a category"
            searchPlaceholder="Find a category"
            inputRef={register("categoryId")}
            invalid={Boolean(fields.categoryId)}
            describedBy={described("categoryId")}
            readOnly={submitting}
            onChange={(categoryId) => entry.change({ categoryId })}
          />,
        )}
        {field("outflow", "Outflow", amount("outflow"))}
        {field("inflow", "Inflow", amount("inflow"))}
        {field(
          "accountId",
          "Account",
          <ChoiceField
            id={id("accountId")}
            label="Account"
            value={draft.accountId}
            options={accountOptions}
            placeholder="Choose an account"
            searchPlaceholder="Find an account"
            inputRef={register("accountId")}
            invalid={Boolean(fields.accountId)}
            describedBy={described("accountId", editing)}
            disabled={editing}
            readOnly={submitting}
            onChange={(accountId) => entry.change({ accountId })}
          />,
          editing ? "A saved transaction stays in its account." : undefined,
        )}
        {field(
          "status",
          "Bank status",
          select(
            "status",
            [
              { value: "posted", label: "Posted" },
              { value: "pending", label: "Pending" },
            ],
            (status) =>
              entry.change({ status: status as TransactionDraft["status"] }),
          ),
        )}
      </div>

      <div className={styles.detailsToggle}>
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={session.detailsOpen}
          aria-controls={detailsId}
          onClick={() => entry.setDetailsOpen(!session.detailsOpen)}
        >
          {session.detailsOpen ? (
            <ChevronUpIcon aria-hidden />
          ) : (
            <ChevronDownIcon aria-hidden />
          )}
          {session.detailsOpen ? "Fewer details" : "More details"}
        </Button>
      </div>
      {session.detailsOpen && (
        <div id={detailsId} className={styles.details}>
          {field(
            "expenseMonth",
            "Expense belongs to",
            <div
              className={styles.well}
              data-invalid={fields.expenseMonth ? "" : undefined}
            >
              {textInput("expenseMonth", { type: "month", hint: true })}
            </div>,
            "Use the due month for rent. The payment date stays in your account.",
          )}
          {view.sharedCategories.length > 0 &&
            field(
              "sharedCategoryId",
              "Shared category",
              select(
                "sharedCategoryId",
                [
                  {
                    value: "",
                    label: "Personal expense",
                    disabled: Boolean(initial?.sharedCategoryId),
                  },
                  ...view.sharedCategories.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ],
                (sharedCategoryId) => {
                  const next = view.sharedCategories.find(
                    (item) => item.id === sharedCategoryId,
                  );
                  entry.change({
                    sharedCategoryId,
                    ownShare: "",
                    ...(next
                      ? {
                          categoryId:
                            next.categoryIds[view.budget.userId] ?? "",
                        }
                      : {}),
                  });
                },
                true,
              ),
              "A shared expense uses its paired budget category.",
            )}
          {draft.sharedCategoryId &&
            field(
              "ownShare",
              "Your share (optional)",
              <div
                className={styles.well}
                data-invalid={fields.ownShare ? "" : undefined}
              >
                <span className={styles.prefix} aria-hidden>
                  $
                </span>
                {textInput("ownShare", {
                  inputMode: "decimal",
                  placeholder: "Use the category split",
                  hint: true,
                })}
              </div>,
              ownShare !== undefined
                ? `Your original share was ${formatMoney(ownShare)}. Leave blank to keep the original split.`
                : "The rest belongs to your partner. Leave blank to use the category split.",
            )}
        </div>
      )}

      {session.error && (
        <p
          ref={register("error")}
          tabIndex={-1}
          className={styles.formError}
          role="status"
        >
          <CircleAlertIcon size={13} aria-hidden />
          {session.error}
        </p>
      )}

      <div className={styles.footer}>
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
    </form>
  );
}
