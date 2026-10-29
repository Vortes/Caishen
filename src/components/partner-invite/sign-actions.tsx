import type { CSSProperties } from "react";
import { Button } from "~/components/ui/button";
import { CARD, LANDING, type View } from "./geometry";
import styles from "./lab.module.css";

// Undo, Clear, and Sign, hung under the card's bottom right corner on a
// stage of this size, seen at this fit.
export function SignActions({
  stage,
  fit,
  signing,
  onUndo,
  onClear,
  onSign,
}: {
  stage: { width: number };
  fit: { scale: number; view: View };
  signing: boolean;
  onUndo: () => void;
  onClear: () => void;
  onSign: () => void;
}) {
  const { scale, view } = fit;
  const top = (LANDING.y + CARD.height / 2 - view.y) * scale;
  const right = stage.width - (LANDING.x + CARD.width / 2 - view.x) * scale;
  return (
    <div
      className={styles.signActions}
      style={
        {
          "--card-bottom": `${top}px`,
          "--card-right": `${right}px`,
        } as CSSProperties
      }
    >
      <div className={styles.signEdits}>
        <Button disabled={signing} onClick={onUndo}>
          Undo
        </Button>
        <Button disabled={signing} onClick={onClear}>
          Clear
        </Button>
      </div>
      <Button variant="primary" disabled={signing} onClick={onSign}>
        {signing ? "Signing…" : "Sign"}
      </Button>
    </div>
  );
}
