"use client";

import { useState, type ReactNode } from "react";
import { SurfaceProvider } from "~/components/ui/surface";
import { useSavedSettings } from "~/components/app-shell/settings";
import styles from "./entry.module.css";

export function EntryPage({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { theme } = useSavedSettings();
  return (
    <div ref={setRoot} className={styles.page} data-theme={theme}>
      <SurfaceProvider container={root}>{children}</SurfaceProvider>
    </div>
  );
}
