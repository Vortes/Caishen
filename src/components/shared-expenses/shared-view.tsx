"use client";

import { Button } from "~/components/ui/button";

import { useState } from "react";
import { Amount, EmptyState, Icon } from "~/components/shared";
import { type Panel, type View } from "~/components/budget/types";
import { formatMoney, monthName } from "~/components/budget/format";

export function SharedView({
  view,
  month,
  open,
  inviteCode,
  inviteBusy,
  inviteError,
  onInvite,
}: {
  view: View;
  month: string;
  open: (panel: Panel) => void;
  inviteCode?: string;
  inviteBusy: boolean;
  inviteError?: string;
  onInvite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const partner = view.members.find(
    (member) => member.userId !== view.budget.userId,
  );
  return (
    <div className="stack">
      {!partner && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Two budgets. One shared understanding.</h2>
              <p>
                Connect with your partner to share only what you need to settle
                expenses.
              </p>
            </div>
          </div>
          <div className="panel-body">
            <p
              className="muted text-body leading-[1.5]"
              style={{ maxWidth: "65ch" }}
            >
              Your account balances and unrelated transactions stay private.
              Your partner creates their own budget, then joins using your
              invitation code.
            </p>
            <div className="heading-actions" style={{ marginTop: 17 }}>
              <Button disabled={inviteBusy} onClick={onInvite}>
                {inviteBusy ? "Creating invitation…" : "Create invitation code"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => open({ type: "join" })}
              >
                Enter partner’s code
              </Button>
            </div>
            {inviteCode && (
              <div style={{ marginTop: 20 }}>
                <p className="section-label">
                  Share this code with your partner
                </p>
                <p className="inline-code">{inviteCode}</p>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(inviteCode);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy code"}
                </Button>
              </div>
            )}
            {inviteError && (
              <p className="form-error" role="alert" style={{ marginTop: 15 }}>
                {inviteError}
              </p>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{monthName(month)} settlement</h2>
            <p>
              Unpaid amounts carry forward. Viewing this report changes nothing.
            </p>
          </div>
          {partner && (
            <Button
              variant="secondary"
              disabled={
                view.settlement.net < 0 ||
                !view.obligations.some(
                  (obligation) => obligation.outstanding > 0,
                )
              }
              onClick={() => open({ type: "settlement" })}
            >
              Record net repayment
            </Button>
          )}
        </div>
        <div className="report-summary">
          <div>
            <span>You owe</span>
            <strong>
              <Amount value={view.settlement.youOwe} />
            </strong>
          </div>
          <div>
            <span>Owed to you</span>
            <strong>
              <Amount value={view.settlement.owedToYou} />
            </strong>
          </div>
          <div>
            <span>
              {view.settlement.net >= 0
                ? "Your net payment"
                : "Net owed to you"}
            </span>
            <strong>
              <Amount value={Math.abs(view.settlement.net)} />
            </strong>
          </div>
        </div>
        {view.obligations.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Shared expense</th>
                  <th>Expense period</th>
                  <th>Direction</th>
                  <th className="number">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {view.obligations.map((obligation) => (
                  <tr key={obligation.id}>
                    <td>
                      <strong>
                        {
                          view.sharedCategories.find(
                            (category) =>
                              category.id === obligation.sharedCategoryId,
                          )?.name
                        }
                      </strong>
                      <small>
                        {obligation.opening
                          ? "Opening amount · already split"
                          : (obligation.payee ?? "Shared expense")}
                      </small>
                    </td>
                    <td>
                      {obligation.expenseMonth
                        ? monthName(obligation.expenseMonth)
                        : "Opening balance"}
                    </td>
                    <td>
                      {obligation.debtorId === view.budget.userId
                        ? "You owe partner"
                        : "Partner owes you"}
                    </td>
                    <td className="number">
                      <Amount value={obligation.outstanding} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="shared" title="A clear start, together.">
            Shared purchases and opening amounts owed will appear here. Only
            actual repayments clear your balance.
          </EmptyState>
        )}
        <div className="panel-footer">
          <Icon name="shield" size={13} />
          Make repayments in your banking app, then record them here.
        </div>
      </section>
      <section className="panel">
        <details className="shared-inspection">
          <summary>Inspect full payments and original splits</summary>
          {view.sharedExpenses.length ? (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Paid by</th>
                    <th className="number">Full amount paid</th>
                    <th className="number">Your share</th>
                    <th className="number">Partner’s share</th>
                    <th>History</th>
                  </tr>
                </thead>
                <tbody>
                  {view.sharedExpenses
                    .filter((expense) => expense.expenseMonth === month)
                    .map((expense) => (
                      <tr key={`${expense.payerId}:${expense.transactionId}`}>
                        <td>
                          <strong>{expense.payee}</strong>
                          <small>
                            {expense.date} · for{" "}
                            {monthName(expense.expenseMonth)}
                          </small>
                        </td>
                        <td>
                          {expense.payerId === view.budget.userId
                            ? "You"
                            : "Partner"}
                        </td>
                        <td className="number">
                          <Amount value={expense.amountPaid} />
                        </td>
                        <td className="number">
                          <Amount
                            value={expense.shares[view.budget.userId] ?? 0}
                          />
                        </td>
                        <td className="number">
                          <Amount
                            value={
                              partner
                                ? (expense.shares[partner.userId] ?? 0)
                                : 0
                            }
                          />
                        </td>
                        <td>
                          <details>
                            <summary className="small muted">
                              {expense.history.length} records
                            </summary>
                            {expense.history.map((entry, index) => (
                              <p className="field-hint" key={index}>
                                {entry.date} · {entry.reason} · {entry.status} ·{" "}
                                <Amount value={entry.amount} />
                              </p>
                            ))}
                          </details>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small" style={{ padding: 20 }}>
              Shared purchases will retain the payer’s full payment and the
              original allocation for both people to inspect.
            </p>
          )}
        </details>
      </section>
      <div className="two-column">
        <section className="panel">
          <div className="panel-header">
            <h2>Shared categories</h2>
            <Button
              variant="ghost"
              disabled={!partner}
              onClick={() => open({ type: "opening" })}
            >
              Opening amount owed
            </Button>
          </div>
          <div className="panel-body">
            {view.sharedCategories.length ? (
              view.sharedCategories.map((category) => (
                <div className="account-row" key={category.id}>
                  <span className="account-symbol">
                    <Icon name="shared" size={17} />
                  </span>
                  <div className="account-label">
                    <strong>{category.name}</strong>
                    <small>
                      Your split:{" "}
                      {Math.round(
                        ((category.weights[view.budget.userId] ?? 0) /
                          Object.values(category.weights).reduce(
                            (sum, weight) => sum + weight,
                            0,
                          )) *
                          100,
                      )}
                      % · full cash funded separately
                    </small>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      open({ type: "shared-category", id: category.id })
                    }
                  >
                    Edit
                  </Button>
                </div>
              ))
            ) : (
              <p className="muted small">
                {partner
                  ? "Create a shared category and choose its split. Equal shares are the default."
                  : "Connect with your partner to create shared categories."}
              </p>
            )}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>Reimbursements</h2>
            <Button
              variant="ghost"
              disabled={
                !view.budget.transactions.some(
                  (transaction) => transaction.amount < 0,
                )
              }
              onClick={() => open({ type: "reimbursement" })}
            >
              <Icon name="plus" size={14} />
              Add expected
            </Button>
          </div>
          <div className="panel-body">
            {view.reimbursements.length ? (
              view.reimbursements.map((claim) => (
                <div className="account-row" key={claim.id}>
                  <span className="account-symbol">
                    <Icon name="transactions" size={17} />
                  </span>
                  <div className="account-label">
                    <strong>{claim.name}</strong>
                    <small>
                      {formatMoney(claim.outstanding)} expected ·{" "}
                      {claim.kind === "cash" ? "cash" : "statement credit"}
                    </small>
                  </div>
                  {claim.outstanding > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        open({
                          type:
                            claim.kind === "cash"
                              ? "receive"
                              : "statement-credit",
                          id: claim.id,
                        })
                      }
                    >
                      Record received
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p className="muted small">
                Expected reimbursements stay separate from spendable cash.
                Record receipts when the money actually arrives.
              </p>
            )}
          </div>
        </section>
      </div>
      {view.settlements
        .filter(
          (settlement) =>
            settlement.recipientId === view.budget.userId &&
            !settlement.received,
        )
        .map((settlement) => (
          <section className="panel info-card" key={settlement.id}>
            <h2>
              Partner recorded a repayment of{" "}
              <Amount value={settlement.amount} />
            </h2>
            <p>
              Confirm the actual deposit in your account before recording
              receipt.
            </p>
            <Button
              variant="secondary"
              onClick={() =>
                open({ type: "receive", id: `settlement:${settlement.id}` })
              }
            >
              Record receipt
            </Button>
          </section>
        ))}
    </div>
  );
}
