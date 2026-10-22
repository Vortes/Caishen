// The keyboard's undo and redo, shared by every screen with a history.

export type HistoryDirection = "undo" | "redo";

/** Cmd+Z, Cmd+Shift+Z, and Ctrl+Y; null for any other key. */
export function shortcutDirection(
  event: KeyboardEvent,
): HistoryDirection | null {
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

/** Whether the key went to a field or dialog, whose own undo applies. */
export function isEditing(event: KeyboardEvent) {
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
