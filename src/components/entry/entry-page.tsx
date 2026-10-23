"use client";

import { useState, type ReactNode } from "react";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useSavedSettings } from "~/components/app-shell/settings";
import styles from "./entry.module.css";

export function EntryPage({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { theme } = useSavedSettings();
  return (
    <div ref={setRoot} className={styles.page} data-theme={theme}>
      <TooltipProvider container={root}>{children}</TooltipProvider>
    </div>
  );
}
