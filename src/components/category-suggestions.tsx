"use client";

import { api, type RouterOutputs } from "~/trpc/react";
import { useState } from "react";
import { type Command } from "~/domain/engine";
import { Icon } from "~/components/ui";

type State = NonNullable<RouterOutputs["budget"]["state"]>;

export function CategorySuggestions({
  state,
  selected,
  run,
  busy,
}: {
  state: State;
  selected: string[];
  run: (command: Command) => void;
  busy: boolean;
}) {
  const suggestions = api.budget.suggest.useMutation();
  const utils = api.useUtils();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const approve = api.budget.approveSuggestions.useMutation({
    onSuccess: async () => {
      setOperationId(crypto.randomUUID());
      await utils.budget.state.invalidate();
    },
  });
  const view = state.view!;
  const available =
    state.services.find((service) => service.name === "OpenRouter")?.status ===
    "configured";
  const transactionIds = view.budget.transactions
    .filter(
      (transaction) =>
        selected.includes(transaction.id) &&
        !transaction.removed &&
        transaction.kind === "purchase",
    )
    .map((transaction) => transaction.id);
  return (
    <div className="suggestion-area">
      <div className="suggestion-head">
        <div>
          <strong>Category suggestions</strong>
          <p>
            {available
              ? "Select purchases to get suggestions. Correct individual categories, then approve the remaining suggestions together."
              : "OpenRouter needs service setup. You can choose categories and approve transactions manually."}
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={
            !available || !transactionIds.length || suggestions.isPending
          }
          onClick={() => suggestions.mutate({ transactionIds })}
        >
          {suggestions.isPending ? "Reviewing payees…" : "Suggest categories"}
        </button>
      </div>
      {approve.error && (
        <p className="form-error" role="alert">
          {approve.error.message}
        </p>
      )}
      {suggestions.error && (
        <p className="form-error" role="alert">
          ! {suggestions.error.message}
        </p>
      )}
      {suggestions.data && (
        <div>
          <button
            className="secondary-button"
            disabled={
              busy ||
              approve.isPending ||
              !suggestions.data.some(
                (item) =>
                  item.categoryId &&
                  selected.includes(item.transactionId) &&
                  view.budget.transactions.some(
                    (transaction) =>
                      transaction.id === item.transactionId &&
                      !transaction.reviewed,
                  ),
              )
            }
            onClick={() => {
              const items = suggestions.data
                .filter(
                  (item) =>
                    item.categoryId &&
                    selected.includes(item.transactionId) &&
                    view.budget.transactions.some(
                      (transaction) =>
                        transaction.id === item.transactionId &&
                        !transaction.reviewed,
                    ),
                )
                .map((item) => ({
                  transactionId: item.transactionId,
                  categoryId: item.categoryId!,
                }));
              if (items.length)
                approve.mutate({
                  operationId,
                  expectedRevision: state.revision,
                  items,
                });
            }}
          >
            {approve.isPending ? "Approving…" : "Approve selected suggestions"}
          </button>
          {suggestions.data.map((suggestion) => {
            const transaction = view.budget.transactions.find(
              (item) => item.id === suggestion.transactionId,
            );
            const category = view.categories.find(
              (item) => item.id === suggestion.categoryId,
            );
            return (
              <div className="suggestion-row" key={suggestion.transactionId}>
                <div>
                  <strong>
                    {transaction?.payee} <Icon name="arrow" size={12} />{" "}
                    {category?.name ?? "Needs your judgment"}
                  </strong>
                  <p>{suggestion.reason}</p>
                </div>
                <button
                  className="text-button"
                  disabled={
                    busy || !category || transaction?.categoryId === category.id
                  }
                  onClick={() => {
                    if (category)
                      run({
                        type: "transaction.categorize",
                        id: crypto.randomUUID(),
                        transactionId: suggestion.transactionId,
                        categoryId: category.id,
                      });
                  }}
                >
                  {transaction?.categoryId === category?.id
                    ? "Applied"
                    : "Apply category"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
