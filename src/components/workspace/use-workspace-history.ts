"use client";

import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { State } from "~/components/budget/types";
import { api } from "~/trpc/react";

type Direction = "undo" | "redo";

function shortcutDirection(event: KeyboardEvent): Direction | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.metaKey === event.ctrlKey
  )
    return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";
  return null;
}

function isEditing(event: KeyboardEvent) {
  return event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches(
            'input, textarea, select, [role="textbox"], [role="dialog"]',
          )),
    );
}

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
    (direction: Direction) => {
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
      if (!direction || isEditing(event) || unavailable || !history[direction])
        return;
      event.preventDefault();
      perform(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, perform, unavailable]);

  return {
    history,
    disabled: unavailable,
    undo: () => perform("undo"),
    redo: () => perform("redo"),
  };
}
