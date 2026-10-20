"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { Command } from "~/domain/engine";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";
import {
  previewBudgetCommand,
  rollbackBudgetCommand,
} from "./optimistic-cache";

export function useBudgetCommand({
  onSuccess,
  onError,
}: {
  onSuccess: (command: Command) => void;
  onError: (error: TRPCClientErrorLike<AppRouter>, command: Command) => void;
}) {
  const client = useQueryClient();
  const utils = api.useUtils();
  return api.budget.execute.useMutation({
    retry: false,
    onMutate: ({ command, expectedRevision }) =>
      previewBudgetCommand(
        client,
        getQueryKey(api.budget.state, undefined, "query"),
        command,
        expectedRevision,
      ),
    onSuccess: (_result, { command }) => onSuccess(command),
    onError: (error, { command }, snapshots) => {
      rollbackBudgetCommand(client, snapshots);
      onError(error, command);
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
