import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { State } from "~/components/budget/types";
import type { Command } from "~/domain/engine";
import { optimisticState } from "./optimistic-state";

type Snapshot = {
  key: QueryKey;
  previous: State;
  optimistic: State;
  updatedAt: number;
};

export async function previewBudgetCommand(
  client: QueryClient,
  queryKey: QueryKey,
  command: Command,
  expectedRevision: number,
): Promise<Snapshot[]> {
  await client.cancelQueries({ queryKey });
  const snapshots: Snapshot[] = [];
  for (const [key, previous] of client.getQueriesData<State>({
    queryKey,
    type: "active",
  })) {
    if (previous?.revision !== expectedRevision) continue;
    const next = optimisticState(previous, command);
    if (next === previous) continue;
    const updatedAt = client.getQueryState(key)!.dataUpdatedAt;
    const optimistic = client.setQueryData<State>(key, next)!;
    snapshots.push({ key, previous, optimistic, updatedAt });
  }
  return snapshots;
}

export function rollbackBudgetCommand(
  client: QueryClient,
  snapshots: Snapshot[] | undefined,
) {
  for (const { key, previous, optimistic, updatedAt } of snapshots ?? []) {
    // A newer server response must survive an older request's failure.
    if (client.getQueryData(key) === optimistic)
      client.setQueryData(key, previous, { updatedAt });
  }
}
