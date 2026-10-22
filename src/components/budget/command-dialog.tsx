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
import { ExpectedReimbursementForm } from "~/components/reimbursements/expected-reimbursement-form";
import { ReceiptForm } from "~/components/reimbursements/receipt-form";
import { Amount, Dialog } from "~/components/shared";
import { JoinBudgetForm } from "~/components/shared-expenses/join-budget-form";
import { OpeningObligationForm } from "~/components/shared-expenses/opening-obligation-form";
import { SettlementForm } from "~/components/shared-expenses/settlement-form";
import { SharedCategoryForm } from "~/components/shared-expenses/shared-category-form";
import { TransactionHistory } from "~/components/transactions/transaction-history";
import type { Command } from "~/domain/engine";
import { api, type RouterOutputs } from "~/trpc/react";

const saveLabels: Partial<Record<Panel["type"], string>> = {
  account: "Add account",
  category: "Create category",
  assign: "Assign money",
  "card-payment": "Record payment",
  "statement-credit": "Record posted credit",
  reimbursement: "Save expected reimbursement",
  receive: "Record receipt",
  "shared-category": "Save shared category",
  opening: "Save opening amount",
  settlement: "Record repayment",
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
  reimbursement: "Expect a reimbursement",
  receive: "Record money received",
  "shared-category": "Share with your partner",
  opening: "Opening amount owed",
  settlement: "Record a net repayment",
  loan: "Add a loan",
  "loan-payment": "Record a lender payment",
  rate: "Update a confirmed loan rate",
  reconcile: "Reconcile a bank statement",
  join: "Connect with your partner",
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
  onJoin: (code: string) => void;
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
  onJoin,
}: CommandDialogProps) {
  const [operationId] = useState(newId);
  const [entityId] = useState(newId);
  const [fileText, setFileText] = useState("");
  const [confirmSharedDelete, setConfirmSharedDelete] = useState(false);
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
  const shared = view.sharedCategories.find((item) => item.id === panel.id);
  const loan = view.loans.find((item) => item.id === panel.id);
  const claim = view.reimbursements.find((item) => item.id === panel.id);
  const noAccounts =
    [
      "card-payment",
      "statement-credit",
      "receive",
      "loan-payment",
      "reconcile",
    ].includes(panel.type) && !view.accounts.length;
  const noCategories = panel.type === "assign" && view.categories.length === 0;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || reconcile.isPending) return;
    onError("");
    const data = new FormData(event.currentTarget);
    try {
      if (panel.type === "shared-category" && confirmSharedDelete && shared) {
        run({
          type: "shared.remove",
          id: operationId,
          sharedCategoryId: shared.id,
        });
      } else if (panel.type === "import") {
        onImport(fileText || text(data, "importText"));
      } else if (panel.type === "join") {
        onJoin(text(data, "code"));
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
        {panel.type === "join" && <JoinBudgetForm />}
        {panel.type === "card-payment" && (
          <CardPaymentForm
            view={view}
            defaultAccountId={panel.accountId ?? panel.id}
          />
        )}
        {panel.type === "statement-credit" && (
          <StatementCreditForm
            view={view}
            claim={claim}
            defaultAccountId={panel.accountId ?? panel.id}
          />
        )}
        {panel.type === "reimbursement" && (
          <ExpectedReimbursementForm view={view} />
        )}
        {panel.type === "receive" && (
          <ReceiptForm
            view={view}
            claim={claim}
            settlement={view.sharedStatement.awaitingYourConfirmation.find(
              (item) => `settlement:${item.settlementId}` === panel.id,
            )}
          />
        )}
        {panel.type === "shared-category" && !confirmSharedDelete && (
          <SharedCategoryForm
            view={view}
            shared={shared}
            categoryId={panel.categoryId}
          />
        )}
        {panel.type === "shared-category" && confirmSharedDelete && shared && (
          <p>
            Delete “{shared.name}” for both participants? Both personal budget
            categories and their assigned money will be kept. Shared categories
            with recorded activity cannot be deleted.
          </p>
        )}
        {panel.type === "opening" && <OpeningObligationForm view={view} />}
        {panel.type === "settlement" && <SettlementForm view={view} />}
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
      {panel.type === "shared-category" && shared && !confirmSharedDelete && (
        <div className="border-border mt-6 border-t pt-4">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              onError("");
              setConfirmSharedDelete(true);
            }}
          >
            Delete shared category
          </Button>
        </div>
      )}
      <div className="form-actions">
        <Button type="button" variant="secondary" onClick={onClose}>
          {panel.type === "history" ? "Close" : "Cancel"}
        </Button>
        {panel.type !== "history" && (
          <Button
            type="submit"
            variant={confirmSharedDelete ? "destructive" : "default"}
            disabled={busy || reconcile.isPending || noAccounts || noCategories}
          >
            {busy || reconcile.isPending
              ? confirmSharedDelete
                ? "Deleting…"
                : "Saving…"
              : confirmSharedDelete
                ? "Delete shared category"
                : panel.type === "reconcile"
                  ? "Compare statement"
                  : panel.type === "import"
                    ? "Import categories only"
                    : panel.type === "join"
                      ? "Connect budgets"
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
          : panel.type === "shared-category" && shared
            ? confirmSharedDelete
              ? "Delete shared category?"
              : "Edit shared category"
            : dialogTitles[panel.type]
      }
      description={
        panel.type === "assign"
          ? "A manual decision, using only your real cash."
          : panel.type === "settlement"
            ? "Record a payment you’ve already made. Mutual obligations are offset without a fictional deposit."
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
