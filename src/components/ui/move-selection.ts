import type { KeyboardEvent } from "react";

// Arrow keys move the selection through the rows of a list, like Linear's j/k.
export function moveSelection(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-row]"),
  ];
  const index = rows.findIndex((row) => row === document.activeElement);
  const next =
    rows[
      index === -1
        ? 0
        : Math.min(
            rows.length - 1,
            Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)),
          )
    ];
  if (!next) return;
  event.preventDefault();
  next.focus();
  next.click();
}
