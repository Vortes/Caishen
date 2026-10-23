"use client";

import { CloudOffIcon, InfoIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { EmptyAppFrame } from "./empty-app-frame";
import shell from "~/components/app-shell/shell.module.css";
import styles from "./load-error.module.css";

export function BudgetLoadError({
  onRetry,
  error,
}: {
  onRetry: () => void;
  error?: string;
}) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const Icon = offline ? CloudOffIcon : InfoIcon;
  return (
    <EmptyAppFrame>
      <div className={`${shell.empty} ${styles.message}`} role="alert">
        <Icon size={18} aria-hidden />
        <div className={shell.emptyBody}>
          <p>
            <strong>
              {offline ? "You’re offline." : "Your budget couldn’t load."}
            </strong>
            {offline
              ? "It opens on its own as soon as this device is back online."
              : (error ?? "The server didn’t answer. Try again in a moment.")}
          </p>
          <div>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </div>
      </div>
    </EmptyAppFrame>
  );
}
