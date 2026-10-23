"use client";
import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  PanelLeftIcon,
  WalletCardsIcon,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { TooltipProvider } from "~/components/ui/tooltip";
import { useSavedSettings } from "~/components/app-shell/settings";
import shell from "~/components/app-shell/shell.module.css";
import styles from "./load-error.module.css";
export function EmptyAppFrame({ children }: { children: ReactNode }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const settings = useSavedSettings();
  return (
    <div ref={setRoot} className={shell.root} data-theme={settings.theme}>
      <TooltipProvider container={root}>
        <Frame>{children}</Frame>
      </TooltipProvider>
    </div>
  );
}
const nav: { icon: LucideIcon; label: string }[] = [
  { icon: WalletCardsIcon, label: "Plan" },
  { icon: ChartPieIcon, label: "Reflect" },
  { icon: ArrowLeftRightIcon, label: "All accounts" },
  { icon: ChartNoAxesCombinedIcon, label: "Loans" },
];

// The shell's frame with nothing that depends on the budget: the same
// sidebar and panel the skeleton draws, minus the bones. Inert until the
// budget loads, so nothing that looks like navigation can take focus.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <aside
        className={`${shell.sidebar} ${styles.sidebar}`}
        style={{ width: 320 }}
        aria-hidden
        inert
      >
        <div className={shell.sidebarInner} style={{ width: 320 }}>
          <div className={shell.sidebarNav}>
            <div className={shell.sidebarHeader}>
              <span />
              <IconButton label="Hide sidebar">
                <PanelLeftIcon aria-hidden />
              </IconButton>
            </div>
            <div className={shell.sidebarScroll}>
              <ul className={`${shell.navList} ${styles.dimNav}`}>
                {nav.map(({ icon: Icon, label }) => (
                  <li key={label}>
                    <span className={shell.navItem}>
                      <Icon size={14} className={shell.navIcon} aria-hidden />
                      <span className={shell.navLabel}>{label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>
      <div className={shell.main}>
        <div className={shell.panel}>
          <header className={shell.header} aria-hidden inert>
            <div className={shell.titleGroup}>
              <span className={shell.headerTitle}>Plan</span>
            </div>
          </header>
          <div className={styles.panelBody}>{children}</div>
        </div>
      </div>
    </>
  );
}
