"use client";

import { Button } from "~/components/ui-legacy/button";

import { useState } from "react";

import { AccountForm } from "~/components/accounts/account-form";
import { CardPaymentForm } from "~/components/accounts/card-payment-form";
import { StatementCreditForm } from "~/components/accounts/statement-credit-form";
import { ReconcileForm } from "~/components/banks/reconcile-form";
import { AssignmentForm } from "~/components/budget/assignment-form";
import { buildCommand } from "~/components/budget/build-command";
import { CategoryForm } from "~/components/budget/category-form";
import { CategoryImportForm } from "~/components/budget/category-import-form";
import { money, newId, text } from "~/components/budget/format";
import type { Panel, View } from "~/components/budget/types";
import { LoanForm } from "~/components/loans/loan-form";
import { LoanPaymentForm } from "~/components/loans/loan-payment-form";
import { LoanRateForm } from "~/components/loans/loan-rate-form";
import { Amount, Dialog } from "~/components/shared";
import { TransactionHistory } from "~/components/transactions/transaction-history";
import type { Command } from "~/domain/engine";
import { api, type RouterOutputs } from "~/trpc/react";

const saveLabels: Partial<Record<Panel["type"], string>> = {
  account: "Add account",
  category: "Create category",
  assign: "Assign money",
  "card-payment": "Record payment",
  "statement-credit": "Record posted credit",
  loan: "Add loan",
  "loan-payment": "Record lender payment",
  rate: "Save confirmed rate",
};

const dialogTitles: Record<Panel["type"], string> = {
  account: "Add an account",
  category: "Create a category",
  assign: "Assign your money",
  import: "Bring your categories from YNAB",
  "card-payment": "Record a card payment",
  "statement-credit": "Record a statement credit",
  loan: "Add a loan",
  "loan-payment": "Record a lender payment",
  rate: "Update a confirmed loan rate",
  reconcile: "Reconcile a bank statement",
  history: "Transaction history",
};

export type CommandDialogProps = {
  panel: Panel;
  view: View;
  month: string;
  error: string;
  busy: boolean;
  run: (command: Command) => void;
  onClose: () => void;
  onError: (error: string) => void;
  onImport: (text: string) => void;
};

export function CommandDialog(props: CommandDialogProps) {
  return (
    <CommandDialogContent
      key={`${props.panel.type}:${props.panel.id ?? ""}:${props.panel.accountId ?? ""}`}
      {...props}
    />
  );
}

function CommandDialogContent({
  panel,
  view,
  month,
  error,
  busy,
  run,
  onClose,
  onError,
  onImport,
}: CommandDialogProps) {
  const [operationId] = useState(newId);
  const [entityId] = useState(newId);
  const [fileText, setFileText] = useState("");
  const [result, setResult] = useState<
    RouterOutputs["budget"]["reconcile"] | null
  >(null);
  const utils = api.useUtils();
  const reconcile = api.budget.reconcile.useMutation({
    onSuccess: async (output) => {
      await utils.budget.state.invalidate();
      setResult(output);
    },
    onError: (failure) => onError(failure.message),
  });
  const transaction =
    panel.type === "history"
      ? view.budget.transactions.find((item) => item.id === panel.id)
      : undefined;
  const loan = view.loans.find((item) => item.id === panel.id);
  const noAccounts =
    ["card-payment", "statement-credit", "loan-payment", "reconcile"].includes(
      panel.type,
    ) && !view.accounts.length;
  const noCategories = panel.type === "assign" && view.categories.length === 0;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || reconcile.isPending) return;
    onError("");
    const data = new FormData(event.currentTarget);
    try {
      if (panel.type === "import") {
        onImport(fileText || text(data, "importText"));
      } else if (panel.type === "reconcile") {
        reconcile.mutate({
          accountId: text(data, "accountId"),
          periodStart: text(data, "periodStart"),
          cutoff: text(data, "cutoff"),
          openingBalanceCents: money(data, "openingBalance"),
          closingBalanceCents: money(data, "closingBalance"),
          csv: fileText || text(data, "csv"),
          verified: data.has("verified"),
        });
      } else {
        const command = buildCommand({
          panel,
          view,
          month,
          operationId,
          entityId,
          data,
        });
        if (command) run(command);
      }
    } catch (failure) {
      onError(
        failure instanceof Error
          ? failure.message
          : "Check your entries and try again.",
      );
    }
  };

  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      onError("Choose a file smaller than 2 MB.");
      return;
    }
    setFileText(await file.text());
  };

  const content = (
    <form onSubmit={submit}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {noAccounts && (
        <p className="notice warning">
          Add an account before recording this activity.
        </p>
      )}
      {noCategories && (
        <p className="notice warning">
          Create a category first so this money has a place.
        </p>
      )}
      <div className="form-grid">
        {panel.type === "history" && transaction && (
          <>
            <p>
              <strong>{transaction.payee}</strong> ·{" "}
              <Amount value={transaction.amount} />
            </p>
            <p className="small muted">
              {transaction.kind.replaceAll("-", " ")} · {transaction.date} ·{" "}
              {transaction.status}
            </p>
            <TransactionHistory transaction={transaction} />
          </>
        )}
        {panel.type === "account" && <AccountForm view={view} month={month} />}
        {panel.type === "category" && <CategoryForm />}
        {panel.type === "assign" && (
          <AssignmentForm view={view} month={month} categoryId={panel.id} />
        )}
        {panel.type === "import" && (
          <CategoryImportForm fileText={fileText} readFile={readFile} />
        )}
        {panel.type === "card-payment" && (
          <CardPaymentForm
            view={view}
            defaultAccountId={panel.accountId ?? panel.id}
          />
        )}
        {panel.type === "statement-credit" && (
          <StatementCreditForm
            view={view}
            defaultAccountId={panel.accountId ?? panel.id}
          />
        )}
        {panel.type === "loan" && <LoanForm view={view} />}
        {panel.type === "loan-payment" && <LoanPaymentForm view={view} />}
        {panel.type === "rate" && <LoanRateForm view={view} loan={loan} />}
        {panel.type === "reconcile" && (
          <ReconcileForm
            view={view}
            month={month}
            fileText={fileText}
            readFile={readFile}
            result={result}
            defaultAccountId={panel.accountId}
          />
        )}
      </div>
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {panel.type === "history" ? "Close" : "Cancel"}
        </Button>
        {panel.type !== "history" && (
          <Button
            type="submit"
            disabled={busy || reconcile.isPending || noAccounts || noCategories}
          >
            {busy || reconcile.isPending
              ? "Saving…"
              : panel.type === "reconcile"
                ? "Compare statement"
                : panel.type === "import"
                  ? "Import categories only"
                  : (saveLabels[panel.type] ?? "Save changes")}
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <Dialog
      title={
        panel.type === "history"
          ? "Transaction history"
          : dialogTitles[panel.type]
      }
      description={
        panel.type === "assign"
          ? "A manual decision, using only your real cash."
          : panel.type === "reconcile"
            ? "Compare cleared activity at the same cutoff. Differences remain visible; no balancing adjustment is created."
            : undefined
      }
      onClose={onClose}
    >
      {content}
    </Dialog>
  );
}
