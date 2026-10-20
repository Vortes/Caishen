"use client";

import { useEffect, useState } from "react";
import type { State } from "~/components/budget/types";
import { Icon } from "~/components/shared";
import { Button } from "~/components/ui/button";

export function HistoryControls({
  history,
  disabled,
  onUndo,
  onRedo,
}: {
  history: State["history"];
  disabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [modifier, setModifier] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setModifier("Cmd");
  }, []);

  return (
    <div className="workspace-history" role="group" aria-label="Action history">
      {(["undo", "redo"] as const).map((direction) => {
        const label = direction === "undo" ? "Undo" : "Redo";
        const shortcut = `${modifier}+${direction === "redo" ? "Shift+" : ""}Z`;
        return (
          <Button
            key={direction}
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-keyshortcuts={`${modifier === "Cmd" ? "Meta" : "Control"}+${direction === "redo" ? "Shift+" : ""}Z`}
            title={`${history[direction] ? `${label}: ${history[direction]}` : `Nothing to ${direction}`} (${shortcut})`}
            disabled={disabled || !history[direction]}
            onClick={direction === "undo" ? onUndo : onRedo}
          >
            <Icon name={direction} size={16} />
            {label}
          </Button>
        );
      })}
    </div>
  );
}
