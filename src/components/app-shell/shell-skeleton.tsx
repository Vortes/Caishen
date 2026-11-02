"use client";

import {
  ArrowLeftRightIcon,
  ChartNoAxesCombinedIcon,
  ChartPieIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  WalletCardsIcon,
  ZapIcon,
} from "lucide-react";
import { useSyncExternalStore } from "react";
import { useMediaQuery } from "~/components/shared/use-media-query";
import { IconButton } from "~/components/ui/icon-button";
import { Skeleton } from "~/components/ui/skeleton";
import { SurfaceProvider } from "~/components/ui/surface";
import { Property, SkeletonSection } from "./cards";
import { autoAssignOptions } from "./inspector";
import { MonthLabel } from "./month-picker";
import { findPalette, paletteVars } from "./palettes";
import type { Settings } from "./settings";
import { Caret } from "./sidebar";
import styles from "./shell.module.css";
import skeleton from "./shell-skeleton.module.css";

// Placeholder rows, sized like a small real budget. Widths vary so the
// columns read as text rather than stripes.
const accounts = {
  Cash: [92, 64],
  Credit: [76],
};
const groups = [
  { name: 132, categories: [96] },
  { name: 52, categories: [48, 64, 88] },
  { name: 84, categories: [70, 44, 102, 58] },
];

const subscribeNever = () => () => undefined;

// The app shell while the budget loads: the real frame, in the layout and
// theme saved on this device, with bones wherever the budget's data goes.
// Anything that reads the same for every budget (navigation, the screen
// title, the month, column headers) shows as itself, so only the data
// changes when it arrives.
export function ShellSkeleton({
  settings,
  month,
}: {
  settings: Settings;
  // The month being opened, like "October 2026".
  month: string;
}) {
  const { sidebar, inspector } = settings;
  // The month comes from the clock, and the server's render may be days old:
  // the page is prerendered at build. It shows from the first client render.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  // Narrow screens open the details as a drawer, closed at first.
  const narrow = useMediaQuery("(max-width: 860px)");
  const palette =
    settings.theme === "dark" ? findPalette(settings.palette) : null;
  return (
    <div
      className={`${styles.root} ${skeleton.root}`}
      data-theme={settings.theme}
      data-palette={palette?.name}
      style={palette ? paletteVars(palette) : undefined}
      aria-busy
    >
      <SurfaceProvider container={null}>
        <p className="sr-only" role="status">
          Opening your budget…
        </p>

        <aside
          className={`${styles.sidebar} ${skeleton.sidebar}`}
          style={{ width: sidebar.collapsed ? 0 : sidebar.width }}
          aria-hidden
          inert
        >
          <div className={styles.sidebarInner} style={{ width: sidebar.width }}>
            <div className={styles.sidebarNav}>
              <div className={styles.sidebarHeader}>
                <span className={styles.switcher}>
                  <Skeleton shape="avatar" />
                  <Skeleton width={112} />
                </span>
                <IconButton label="Hide sidebar">
                  <PanelLeftIcon aria-hidden />
                </IconButton>
              </div>
              <div className={styles.sidebarScroll}>
                <ul className={styles.navList}>
                  <NavItem icon={WalletCardsIcon} label="Plan" current />
                  <NavItem icon={ChartPieIcon} label="Reflect" />
                  <NavItem icon={ArrowLeftRightIcon} label="All accounts" />
                  <NavItem icon={ChartNoAxesCombinedIcon} label="Loans" />
                </ul>
                {Object.entries(accounts).map(([label, widths]) => (
                  <section key={label} className={styles.navSection}>
                    <span className={styles.sectionHeading}>
                      <span>{label}</span>
                      <Caret />
                    </span>
                    <div className={styles.sectionBody}>
                      <div>
                        <ul className={`${styles.navList} ${styles.nested}`}>
                          {widths.map((width, index) => (
                            <li key={index}>
                              <span className={styles.navItem}>
                                <span className={styles.navLabel}>
                                  <Skeleton width={width} />
                                </span>
                                <Skeleton width={56} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              <div className={styles.sidebarFooter}>
                <IconButton label="Add account">
                  <PlusIcon aria-hidden />
                </IconButton>
              </div>
            </div>
          </div>
        </aside>

        <div className={styles.main} aria-hidden inert>
          <div className={styles.panel}>
            <header className={styles.header}>
              <div
                className={`${styles.toggleSlot} ${skeleton.toggleSlot}`}
                data-show={sidebar.collapsed || undefined}
              >
                <div>
                  <IconButton label="Show sidebar">
                    <PanelLeftIcon aria-hidden />
                  </IconButton>
                </div>
              </div>
              <div className={styles.monthNav}>
                <IconButton label="Previous month">
                  <ChevronLeftIcon aria-hidden />
                </IconButton>
                <span className={`${styles.monthButton} ${skeleton.month}`}>
                  <MonthLabel year={month.slice(-4)}>
                    {hydrated ? month : <Skeleton width={88} />}
                  </MonthLabel>
                </span>
                <IconButton label="Next month">
                  <ChevronRightIcon aria-hidden />
                </IconButton>
              </div>
            </header>

            <div className={styles.toolbar}>
              <div className={styles.views}>
                {[36, 96, 84, 112, 104, 136].map((width, index) => (
                  <Skeleton key={index} shape="button-sm" width={width} />
                ))}
              </div>
              <div className={styles.toolbarActions}>
                <IconButton
                  label="Show details"
                  variant="secondary"
                  pressed={!narrow && !inspector.collapsed}
                >
                  <PanelRightIcon aria-hidden />
                </IconButton>
              </div>
            </div>

            <div className={styles.body}>
              <div className={styles.content}>
                <div className={styles.list}>
                  <div className={`${styles.columns} ${styles.columnHeader}`}>
                    <span>Category</span>
                    <span className={styles.numeric} data-optional>
                      Assigned
                    </span>
                    <span className={styles.numeric} data-optional>
                      Activity
                    </span>
                    <span className={styles.numeric}>Available</span>
                  </div>
                  {groups.map((group, index) => (
                    <div key={index}>
                      <div className={`${styles.columns} ${styles.groupRow}`}>
                        <Skeleton width={group.name} />
                        <Figures />
                      </div>
                      {group.categories.map((width, index) => (
                        <div
                          key={index}
                          className={`${styles.columns} ${styles.row}`}
                        >
                          <span className={skeleton.category}>
                            <Skeleton width={width} />
                            <Skeleton shape="funding-bar" />
                          </span>
                          <Figures pill />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className={`${styles.inspectorSlot} ${skeleton.inspector}`}>
                <aside
                  className={styles.inspector}
                  style={{ width: inspector.collapsed ? 0 : inspector.width }}
                >
                  <div
                    className={styles.inspectorInner}
                    style={{ width: inspector.width }}
                  >
                    <SkeletonSection title="Ready to Assign">
                      <div className={styles.rtaCard}>
                        <Skeleton shape="figure" width={112} />
                        <div className={styles.rtaAction}>
                          <Skeleton shape="button" />
                        </div>
                      </div>
                    </SkeletonSection>
                    {/* The summary's title holds its height until the month
                        is known. */}
                    <SkeletonSection
                      title={hydrated ? `${month.split(" ")[0]}'s summary` : ""}
                    >
                      {["Last month", "Assigned", "Activity", "Available"].map(
                        (label) => (
                          <Property key={label} label={label}>
                            <Skeleton width={72} />
                          </Property>
                        ),
                      )}
                      <div className={styles.cardSection}>
                        <h3 className={styles.cardSectionTitle}>
                          Cost to Be Me
                        </h3>
                        {["Targets", "Income"].map((label) => (
                          <Property key={label} label={label}>
                            <Skeleton width={72} />
                          </Property>
                        ))}
                      </div>
                    </SkeletonSection>
                    {/* Auto-Assign's options every budget has; only their
                        amounts are data. */}
                    <SkeletonSection title="Auto-Assign">
                      <ul className={styles.actionList}>
                        {autoAssignOptions.map(([option, label]) => (
                          <li key={option}>
                            <span className={styles.actionItem}>
                              <ZapIcon size={13} aria-hidden />
                              <span>{label}</span>
                              <span className={styles.numeric}>
                                <Skeleton width={52} />
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </SkeletonSection>
                  </div>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </SurfaceProvider>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  current,
}: {
  icon: typeof WalletCardsIcon;
  label: string;
  current?: boolean;
}) {
  return (
    <li>
      <span
        className={styles.navItem}
        aria-current={current ? "page" : undefined}
      >
        <Icon size={14} className={styles.navIcon} aria-hidden />
        <span className={styles.navLabel}>{label}</span>
      </span>
    </li>
  );
}

// A plan row's Assigned, Activity, and Available columns.
function Figures({ pill }: { pill?: boolean }) {
  return (
    <>
      <span className={styles.numeric} data-optional>
        <Skeleton width={56} />
      </span>
      <span className={styles.numeric} data-optional>
        <Skeleton width={60} />
      </span>
      <span className={styles.numeric}>
        <Skeleton shape={pill ? "pill" : "text"} width={pill ? 68 : 56} />
      </span>
    </>
  );
}
