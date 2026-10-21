"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BudgetProjection } from "~/domain/engine";
import type { BudgetClient } from "./budget-client";
import type { BudgetSnapshot } from "./budget-store";

// Components read the budget through these hooks. Every store change
// publishes once, after the work that caused it, and a month's numbers are
// computed once per ledger, so switching months or re-rendering is free.

const BudgetClientContext = createContext<BudgetClient | null>(null);

export function BudgetClientProvider({
  client,
  children,
}: {
  client: BudgetClient;
  children: ReactNode;
}) {
  return (
    <BudgetClientContext.Provider value={client}>
      {children}
    </BudgetClientContext.Provider>
  );
}

export function useBudgetClient(): BudgetClient {
  const client = useContext(BudgetClientContext);
  if (!client) throw new Error("useBudgetClient needs a BudgetClientProvider");
  return client;
}

/**
 * A value derived from the store. The selector runs once per published
 * snapshot; return snapshot fields or other values that keep their
 * identity, since a new object every time renders every time.
 */
export function useBudgetSelector<T>(
  selector: (snapshot: BudgetSnapshot) => T,
): T {
  const { store } = useBudgetClient();
  const read = useMemo(() => {
    let last: { snapshot: BudgetSnapshot; value: T } | undefined;
    return () => {
      const snapshot = store.getSnapshot();
      if (last?.snapshot !== snapshot)
        last = { snapshot, value: selector(snapshot) };
      return last.value;
    };
  }, [store, selector]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** The month as shown, with pending changes; null until a budget loads. */
export function useBudgetMonth(month: string): BudgetProjection | null {
  const { store } = useBudgetClient();
  const read = useMemo(() => () => store.month(month), [store, month]);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Runs commands, and undoes and redoes them, against the shown budget. */
export function useCommand() {
  const client = useBudgetClient();
  return useMemo(
    () => ({
      run: client.run,
      runOnServer: client.runOnServer,
      undo: client.undo,
      redo: client.redo,
    }),
    [client],
  );
}
