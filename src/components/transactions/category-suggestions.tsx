"use client";

import { Button } from "~/components/ui-legacy/button";

import { api } from "~/trpc/react";
import { type State } from "~/components/budget/types";
import { useId, useMemo, useState } from "react";
import { type Command } from "~/domain/engine";
import { Icon } from "~/components/shared";

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
  const selectionLimitId = useId();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const approve = api.budget.approveSuggestions.useMutation({
    onSuccess: async () => {
      setOperationId(crypto.randomUUID());
      await utils.budget.state.invalidate();
    },
  });
  const view = state.view!;
  const selectedIdSet = useMemo(() => new Set(selected), [selected]);
  const transactionsById = useMemo(
    () =>
      new Map(
        view.budget.transactions.map((transaction) => [
          transaction.id,
          transaction,
        ]),
      ),
    [view.budget.transactions],
  );
  const categoriesById = useMemo(
    () => new Map(view.categories.map((category) => [category.id, category])),
    [view.categories],
  );
  const isUnreviewed = (id: string) => {
    const transaction = transactionsById.get(id);
    return Boolean(transaction && !transaction.reviewed);
  };
  const available =
    state.services.find((service) => service.name === "OpenRouter")?.status ===
    "configured";
  const transactionIds = view.budget.transactions
    .filter(
      (transaction) =>
        selectedIdSet.has(transaction.id) &&
        !transaction.removed &&
        transaction.kind === "purchase",
    )
    .map((transaction) => transaction.id);
  const selectionLimitExceeded = transactionIds.length > 100;
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
        <Button
          variant="secondary"
          disabled={
            busy ||
            !available ||
            !transactionIds.length ||
            selectionLimitExceeded ||
            suggestions.isPending
          }
          aria-describedby={
            selectionLimitExceeded ? selectionLimitId : undefined
          }
          onClick={() => suggestions.mutate({ transactionIds })}
        >
          {suggestions.isPending ? "Reviewing payees…" : "Suggest categories"}
        </Button>
      </div>
      {selectionLimitExceeded && (
        <p id={selectionLimitId} className="muted" role="status">
          Select up to 100 purchases at a time for category suggestions.
        </p>
      )}
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
          <Button
            variant="secondary"
            disabled={
              busy ||
              approve.isPending ||
              !suggestions.data.some(
                (item) =>
                  item.categoryId &&
                  selectedIdSet.has(item.transactionId) &&
                  isUnreviewed(item.transactionId),
              )
            }
            onClick={() => {
              const items = suggestions.data
                .filter(
                  (item) =>
                    item.categoryId &&
                    selectedIdSet.has(item.transactionId) &&
                    isUnreviewed(item.transactionId),
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
          </Button>
          {suggestions.data.map((suggestion) => {
            const transaction = transactionsById.get(suggestion.transactionId);
            const category = suggestion.categoryId
              ? categoriesById.get(suggestion.categoryId)
              : undefined;
            return (
              <div className="suggestion-row" key={suggestion.transactionId}>
                <div>
                  <strong>
                    {transaction?.payee} <Icon name="arrow" size={12} />{" "}
                    {category?.name ?? "Needs your judgment"}
                  </strong>
                  <p>{suggestion.reason}</p>
                </div>
                <Button
                  variant="ghost"
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
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
