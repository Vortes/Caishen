"use client";

import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { State } from "~/components/budget/types";
import { api } from "~/trpc/react";
import {
  isEditing,
  shortcutDirection,
  type HistoryDirection,
} from "./history-shortcuts";

// Binds Cmd+Z, Cmd+Shift+Z, and Ctrl+Y to the saved history, and returns the
// same guarded change for any visible control that offers it.
export function useWorkspaceHistory({
  state,
  disabled,
  onSuccess,
  onError,
}: {
  state: State;
  disabled: boolean;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}) {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const mutations = useIsMutating();
  const locked = useRef(false);
  const change = api.budget.changeHistory.useMutation({
    onSuccess: async (result, input) => {
      await utils.budget.state.invalidate();
      onSuccess(
        input.direction === "undo" ? "Action undone." : "Action redone.",
      );
      if (result.warning) onError(result.warning);
    },
    onError: async (error) => {
      onError(error.message);
      await utils.budget.state.invalidate();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  const { mutate } = change;
  const history = state.history;
  const unavailable = disabled || mutations > 0;
  const perform = useCallback(
    (direction: HistoryDirection) => {
      if (
        disabled ||
        locked.current ||
        queryClient.isMutating() > 0 ||
        !history[direction]
      )
        return;
      locked.current = true;
      mutate({
        direction,
        expectedRevision: state.revision,
        operationId: crypto.randomUUID(),
      });
    },
    [disabled, history, mutate, queryClient, state.revision],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = shortcutDirection(event);
      if (!direction || isEditing(event)) return;
      // Outside a text field the shortcut belongs to the budget's history.
      // The browser's own undo would jump into the last edited field and
      // revert it, so it never runs here, even while history waits.
      event.preventDefault();
      if (unavailable || !history[direction]) return;
      perform(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, perform, unavailable]);

  return { change: perform, unavailable };
}
