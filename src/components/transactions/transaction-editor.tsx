"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

import { newId } from "~/components/budget/format";
import type { View } from "~/components/budget/types";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui-legacy/button";
import { Input } from "~/components/ui-legacy/input";
import {
  TransactionChoice,
  type TransactionChoiceOption,
} from "~/components/transactions/transaction-choice";
import {
  READY_TO_ASSIGN,
  TransactionDraftError,
  assertTransactionDraftCurrent,
  buildTransactionDraftCommand,
  createTransactionDraft,
  type TransactionDraft,
  type TransactionDraftFields,
} from "~/components/transactions/transaction-draft";
import type { Command } from "~/domain/engine";
import { budgetDay } from "~/domain/user-command";

type Transaction = View["budget"]["transactions"][number];
type SaveAttempt = { fingerprint: string; command: Command };

export type TransactionEditorProps = {
  view: View;
  month: string;
  transaction?: Transaction;
  defaultAccountId?: string;
  showAccount: boolean;
  busy: boolean;
  onSave: (command: Command) => Promise<void>;
  onClose: () => void;
};

export function TransactionEditor({
  view,
  month,
  transaction,
  defaultAccountId,
  showAccount,
  busy,
  onSave,
  onClose,
}: TransactionEditorProps) {
  const formId = useId();
  const initialTransaction = useRef(transaction).current;
  const [entityId, setEntityId] = useState(newId);
  const [draft, setDraft] = useState(() =>
    createTransactionDraft(view, month, transaction, defaultAccountId),
  );
  const [fields, setFields] = useState<TransactionDraftFields>({});
  const [error, setError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const saving = useRef(false);
  const attempt = useRef<SaveAttempt | null>(null);
  const controls = useRef<
    Partial<Record<keyof TransactionDraft, HTMLElement | null>>
  >({});
  const disabled = busy || submitting;
  const editing = Boolean(initialTransaction);
  const selectedAccount = view.accounts.find(
    (account) => account.id === draft.accountId,
  );
  const accountOptions = useMemo<TransactionChoiceOption[]>(
    () =>
      view.accounts.map((account) => ({
        value: account.id,
        label: account.name,
        group: account.kind === "credit" ? "Credit accounts" : "Cash accounts",
      })),
    [view.accounts],
  );
  const categoryOptions: TransactionChoiceOption[] = [
    {
      value: READY_TO_ASSIGN,
      label: "Inflow: Ready to Assign",
      group: "Inflow",
      disabled:
        selectedAccount?.kind === "credit" ||
        Boolean(initialTransaction?.categoryId),
    },
    ...view.categories
      .filter((category) => !category.pairedAccountId && !category.pairedLoanId)
      .map((category) => ({
        value: category.id,
        label: category.name,
        group: category.group,
        amount: category.available,
      })),
  ];
  const payees = useMemo(() => {
    const query = draft.payee.trim().toLowerCase();
    const values = new Set<string>();
    for (const item of view.budget.transactions) {
      if (!item.removed && item.payee.toLowerCase().includes(query))
        values.add(item.payee);
      if (values.size >= 50) break;
    }
    return [...values];
  }, [draft.payee, view.budget.transactions]);
  const focus = (field: keyof TransactionDraft) => {
    if (
      !window.matchMedia("(pointer: coarse)").matches &&
      navigator.maxTouchPoints === 0
    ) {
      controls.current[field]?.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    if (
      !window.matchMedia("(pointer: coarse)").matches &&
      navigator.maxTouchPoints === 0
    ) {
      controls.current[editing ? "categoryId" : "payee"]?.focus({
        preventScroll: true,
      });
    }
  }, [editing]);

  const validate = (value: TransactionDraft) =>
    buildTransactionDraftCommand({
      draft: value,
      view,
      transaction: initialTransaction,
      operationId: "draft",
      entityId: "draft",
    });
  const change = (patch: Partial<TransactionDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setError("");
    if (Object.keys(fields).some((field) => field in patch)) {
      try {
        validate(next);
        setFields({});
      } catch (failure) {
        if (failure instanceof TransactionDraftError) setFields(failure.fields);
      }
    }
  };
  const submit = async (another: boolean) => {
    if (disabled || saving.current) return;
    setError("");
    try {
      const semanticCommand = validate(draft);
      const fingerprint = JSON.stringify(semanticCommand);
      assertTransactionDraftCurrent(
        initialTransaction,
        initialTransaction
          ? transaction
          : view.budget.transactions.find((item) => item.id === entityId),
        attempt.current?.fingerprint === fingerprint
          ? attempt.current.command.id
          : undefined,
      );
      if (attempt.current?.fingerprint !== fingerprint) {
        attempt.current = {
          fingerprint,
          command: buildTransactionDraftCommand({
            draft,
            view,
            transaction: initialTransaction,
            operationId: newId(),
            entityId,
          }),
        };
      }
      setFields({});
      saving.current = true;
      setSubmitting(true);
      await onSave(attempt.current.command);
      attempt.current = null;
      if (another && !editing) {
        setEntityId(newId());
        setDraft({
          ...createTransactionDraft(view, month, undefined, draft.accountId),
          date: draft.date,
          status: draft.status,
        });
        requestAnimationFrame(() => focus("payee"));
      } else onClose();
    } catch (failure) {
      if (failure instanceof TransactionDraftError) {
        setFields(failure.fields);
        const keys = Object.keys(failure.fields) as (keyof TransactionDraft)[];
        if (
          keys.some(
            (field) =>
              field === "expenseMonth" ||
              (!showAccount && field === "accountId"),
          )
        )
          setDetailsOpen(true);
        requestAnimationFrame(() => focus(keys[0] ?? "payee"));
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : "The transaction could not be saved. Try again.",
        );
    } finally {
      saving.current = false;
      setSubmitting(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented && !saving.current) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  const input = (
    field: Exclude<keyof TransactionDraft, "lines" | "counterpartyShare">,
    label: string,
    props: ComponentProps<typeof Input> = {},
    visibleLabel = false,
  ) => (
    <div className="transaction-editor-field">
      <label
        className={visibleLabel ? undefined : "sr-only"}
        htmlFor={`${formId}-${field}`}
      >
        {label}
      </label>
      <Input
        {...props}
        ref={(node) => {
          controls.current[field] = node;
        }}
        id={`${formId}-${field}`}
        name={field}
        form={formId}
        value={draft[field]}
        disabled={disabled}
        aria-invalid={Boolean(fields[field]) || undefined}
        aria-describedby={
          fields[field] ? `${formId}-${field}-error` : undefined
        }
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value;
          change({
            [field]: value,
            ...(field === "outflow" && value.trim()
              ? { inflow: "" }
              : field === "inflow" && value.trim()
                ? { outflow: "" }
                : {}),
          });
        }}
      />
      <FieldError id={`${formId}-${field}-error`} message={fields[field]} />
    </div>
  );
  const accountChoice = (
    <div className="transaction-editor-field">
      <label
        className={showAccount ? "sr-only" : undefined}
        htmlFor={`${formId}-accountId`}
      >
        Account
      </label>
      <TransactionChoice
        ref={(node) => {
          controls.current.accountId = node;
        }}
        id={`${formId}-accountId`}
        label="Account"
        searchLabel="Search accounts"
        value={draft.accountId}
        options={accountOptions}
        placeholder="Choose account"
        disabled={disabled || editing}
        invalid={Boolean(fields.accountId)}
        describedBy={fields.accountId ? `${formId}-accountId-error` : undefined}
        onChange={(value) => change({ accountId: value })}
      />
      <FieldError id={`${formId}-accountId-error`} message={fields.accountId} />
    </div>
  );
  return (
    <>
      <tr className="transaction-editor-row" onKeyDown={onKeyDown}>
        <td className="transaction-editor-cell transaction-editor-selection">
          <span aria-hidden="true">
            <Icon name="check" size={13} />
          </span>
        </td>
        {showAccount && (
          <td className="transaction-editor-cell">{accountChoice}</td>
        )}
        <td className="transaction-editor-cell">
          {input("date", "Date", {
            type: "date",
            min: selectedAccount?.date ?? `${view.budget.startMonth}-01`,
            max: budgetDay(view.budget.settings.timezone),
            required: true,
          })}
        </td>
        <td className="transaction-editor-cell">
          {input("payee", "Payee", {
            placeholder: "Payee",
            list: `${formId}-payees`,
            maxLength: 240,
            required: true,
          })}
          <datalist id={`${formId}-payees`}>
            {payees.map((payee) => (
              <option key={payee} value={payee} />
            ))}
          </datalist>
        </td>
        <td className="transaction-editor-cell">
          <div className="transaction-editor-field">
            <label className="sr-only" htmlFor={`${formId}-categoryId`}>
              Category
            </label>
            <TransactionChoice
              ref={(node) => {
                controls.current.categoryId = node;
              }}
              id={`${formId}-categoryId`}
              label="Category"
              searchLabel="Search categories"
              value={draft.categoryId}
              options={categoryOptions}
              placeholder="Choose category"
              disabled={disabled}
              invalid={Boolean(fields.categoryId)}
              describedBy={
                fields.categoryId ? `${formId}-categoryId-error` : undefined
              }
              onChange={(value) => change({ categoryId: value })}
            />
            <FieldError
              id={`${formId}-categoryId-error`}
              message={fields.categoryId}
            />
          </div>
        </td>
        <td className="transaction-editor-cell transaction-editor-amount">
          {input("outflow", "Outflow", {
            inputMode: "decimal",
            placeholder: "Outflow",
          })}
        </td>
        <td className="transaction-editor-cell transaction-editor-amount">
          {input("inflow", "Inflow", {
            inputMode: "decimal",
            placeholder: "Inflow",
          })}
        </td>
        <td className="transaction-editor-cell">
          <label className="sr-only" htmlFor={`${formId}-status`}>
            Bank status
          </label>
          <select
            ref={(node) => {
              controls.current.status = node;
            }}
            id={`${formId}-status`}
            className="transaction-editor-status"
            form={formId}
            name="status"
            value={draft.status}
            disabled={disabled}
            onChange={(event) =>
              change({
                status: event.target.value as TransactionDraft["status"],
              })
            }
          >
            <option value="posted">Posted</option>
            <option value="pending">Pending</option>
          </select>
        </td>
      </tr>
      <tr className="transaction-editor-details-row" onKeyDown={onKeyDown}>
        <td colSpan={showAccount ? 8 : 7}>
          <form
            id={formId}
            aria-label="Transaction editor"
            className="transaction-editor-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            <p className="transaction-editor-scroll-hint">
              Swipe the row to see all transaction fields.
            </p>
            <details
              className="transaction-editor-details"
              open={detailsOpen}
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
            >
              <summary>Transaction details</summary>
              <div className="transaction-editor-details-fields">
                {!showAccount && accountChoice}
                <div className="transaction-editor-detail-field">
                  {input(
                    "expenseMonth",
                    "Expense belongs to",
                    { type: "month" },
                    true,
                  )}
                  <p className="field-hint">
                    Use the due month for rent. The payment date stays in your
                    account ledger.
                  </p>
                </div>
              </div>
            </details>
            <div className="transaction-editor-actions">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={disabled}>
                {submitting ? "Saving…" : "Save"}
              </Button>
              {!editing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void submit(true)}
                >
                  Save and add another
                </Button>
              )}
            </div>
            {(error || Object.keys(fields).length > 0) && (
              <p className="transaction-editor-error" role="alert">
                {error || Object.values(fields)[0]}
              </p>
            )}
          </form>
        </td>
      </tr>
    </>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="transaction-editor-field-error">
      {message}
    </p>
  ) : null;
}
