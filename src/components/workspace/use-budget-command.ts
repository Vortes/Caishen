"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { Command } from "~/domain/engine";
import type { State } from "~/components/budget/types";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";
import { clientId } from "./client-id";
import {
  previewBudgetCommand,
  rollbackBudgetCommand,
} from "./optimistic-cache";

function useBudgetCommand({
  onSuccess,
  onError,
}: {
  onSuccess: (command: Command, result: { revision: number }) => void;
  onError: (error: TRPCClientErrorLike<AppRouter>, command: Command) => void;
}) {
  const client = useQueryClient();
  const utils = api.useUtils();
  return api.budget.execute.useMutation({
    retry: false,
    onMutate: ({ command, baseRevision }) =>
      previewBudgetCommand(
        client,
        getQueryKey(api.budget.state, undefined, "query"),
        command as Command,
        baseRevision,
      ),
    onSuccess: (result, { command }) => onSuccess(command as Command, result),
    onError: (error, { command }, snapshots) => {
      rollbackBudgetCommand(client, snapshots);
      onError(error, command as Command);
    },
    onSettled: async (_result, _error, _input, snapshots) => {
      try {
        await utils.budget.state.invalidate();
      } finally {
        // Completed mutations need not retain entire ledger snapshots.
        if (snapshots) snapshots.length = 0;
      }
    },
  });
}

// Why a new command can't be sent right now: another change is still saving,
// the month on screen is a placeholder while the next one loads, or the
// budget failed to refresh, so the revision on screen may be stale.
type CommandBlock = "saving" | "loading" | "stale";

// Sends commands against the revision on screen, refusing them while one of
// the blocks above applies. Every screen that writes shares these guards.
export function useRunBudgetCommand({
  state,
  loadingMonth,
  refreshError,
  onSuccess,
  onError,
}: {
  state: State;
  loadingMonth: boolean;
  refreshError?: string;
  onSuccess: (command: Command, result: { revision: number }) => void;
  onError: (error: TRPCClientErrorLike<AppRouter>, command: Command) => void;
}) {
  const queryClient = useQueryClient();
  const execute = useBudgetCommand({ onSuccess, onError });
  const blocked = (): CommandBlock | null =>
    queryClient.isMutating() > 0
      ? "saving"
      : loadingMonth
        ? "loading"
        : refreshError
          ? "stale"
          : null;
  const run = (command: Command) => {
    if (blocked()) return false;
    execute.mutate({ command, baseRevision: state.revision, clientId });
    return true;
  };
  return { execute, blocked, run };
}
