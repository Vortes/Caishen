"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  HeartHandshakeIcon,
  PaletteIcon,
  PanelLeftIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { IconButton } from "~/components/ui/icon-button";
import { TooltipProvider } from "~/components/ui/tooltip";
import shell from "~/components/prototype/app-shell/shell.module.css";
import { SHELL_PATH } from "~/components/prototype/app-shell/settings-pages";
import { settingsPath, type SettingsPage } from "./routes";
import type { Theme } from "./prototype";
import styles from "./settings.module.css";

const pages: { id: SettingsPage; label: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", icon: CircleUserRoundIcon },
  { id: "appearance", label: "Appearance", icon: PaletteIcon },
  { id: "partner", label: "Partner", icon: HeartHandshakeIcon },
];

// The shell's settings, drawn with the shell's own classes so the new pages
// sit exactly where they will: the settings sidebar on the left, the page in
// the main panel. Only the page content is new.
export function SettingsFrame({
  page,
  theme,
  children,
  controls,
}: {
  page: SettingsPage;
  theme: Theme;
  children: ReactNode;
  controls: ReactNode;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const title = pages.find((item) => item.id === page)!.label;
  return (
    <div
      ref={setRoot}
      className={`${shell.root} ${styles.frame}`}
      data-theme={theme}
    >
      <TooltipProvider container={root}>
        <aside
          className={shell.sidebar}
          style={{ width: sidebar ? 320 : 0 }}
          aria-hidden={!sidebar || undefined}
          inert={!sidebar}
        >
          <div className={shell.sidebarInner} style={{ width: 320 }}>
            <nav className={shell.sidebarNav} aria-label="Settings navigation">
              <div className={shell.sidebarHeader}>
                <Link className={shell.switcher} href={SHELL_PATH}>
                  <ChevronLeftIcon size={14} aria-hidden />
                  <span className={shell.switcherName}>Back to app</span>
                </Link>
                <IconButton
                  label="Hide sidebar"
                  shortcut="["
                  onClick={() => setSidebar(false)}
                >
                  <PanelLeftIcon aria-hidden />
                </IconButton>
              </div>
              <div className={shell.sidebarScroll}>
                <h2 className={shell.navHeading}>Settings</h2>
                <ul className={shell.navList}>
                  {pages.map(({ id, label, icon: Icon }) => (
                    <li key={id}>
                      <Link
                        className={shell.navItem}
                        href={settingsPath(id)}
                        aria-current={id === page ? "page" : undefined}
                      >
                        <Icon size={14} className={shell.navIcon} aria-hidden />
                        <span className={shell.navLabel}>{label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </nav>
          </div>
        </aside>
        <div className={shell.main}>
          <div className={shell.panel}>
            <header className={shell.header}>
              {!sidebar && (
                <IconButton
                  label="Show sidebar"
                  shortcut="["
                  onClick={() => setSidebar(true)}
                >
                  <PanelLeftIcon aria-hidden />
                </IconButton>
              )}
              <div className={shell.titleGroup}>
                <span className={shell.crumb}>Settings</span>
                <ChevronRightIcon
                  size={12}
                  className={shell.crumbSeparator}
                  aria-hidden
                />
                <h1 className={shell.headerTitle}>{title}</h1>
              </div>
            </header>
            <div className={shell.body}>
              <main className={shell.content}>{children}</main>
            </div>
          </div>
        </div>
        {controls}
      </TooltipProvider>
    </div>
  );
}
