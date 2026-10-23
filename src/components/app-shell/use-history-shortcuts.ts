"use client";

import { useEffect, useRef } from "react";
import {
  isEditing,
  shortcutDirection,
  type HistoryDirection,
} from "~/components/workspace/history-shortcuts";

// Binds Cmd+Z, Cmd+Shift+Z, and Ctrl+Y to the budget's history while no
// editor or popover is open. Outside a text field the shortcut belongs to
// the budget: the browser's own undo would jump into the last edited field
// and revert it, so it never runs here.
export function useHistoryShortcuts({
  disabled,
  available,
  change,
}: {
  disabled: boolean;
  available: Record<HistoryDirection, boolean>;
  change: (direction: HistoryDirection) => void;
}) {
  const latest = useRef({ disabled, available, change });
  latest.current = { disabled, available, change };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = shortcutDirection(event);
      if (!direction || isEditing(event)) return;
      event.preventDefault();
      const { disabled, available, change } = latest.current;
      if (!disabled && available[direction]) change(direction);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
