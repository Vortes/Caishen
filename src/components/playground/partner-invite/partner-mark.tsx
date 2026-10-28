"use client";

import { useLayoutEffect, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  PaletteIcon,
} from "lucide-react";
import { Card } from "~/components/ui/card";
import shell from "~/components/app-shell/shell.module.css";
import type { Config } from "./config";
import type { Halves } from "./plane-3d";
import { PARTNER } from "./print";
import { joinedBox } from "./torn-card";
import styles from "./lab.module.css";

export type Rect = { left: number; top: number; width: number; height: number };

const FIRST_NAME = PARTNER.split(" ")[0]!;
// The mark's box in the nav, as the icons beside it.
const MARK_SIZE = 14;

// The end of the invitation: Jordan's half, left on the table once you've
// taken yours, shrinks down into the Partner mark, the picture of their
// half the app will show beside Partner from now on.
export function Filed({
  config,
  src,
  from,
  fade,
  reducedMotion,
}: {
  config: Config;
  src: string | null;
  from: () => Rect;
  // How far the clouds have closed over it.
  fade: number;
  reducedMotion: boolean;
}) {
  const picture = useRef<HTMLImageElement>(null);
  const mark = useRef<HTMLImageElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLSpanElement>(null);
  const plate = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = picture.current;
    if (reducedMotion || !element || !mark.current) return;
    const start = from();
    const icon = mark.current.getBoundingClientRect();
    const scale = icon.height / start.height;
    // The half sits in the middle of the mark's square box.
    const left = icon.left + (icon.width - start.width * scale) / 2;
    Object.assign(element.style, {
      left: `${start.left}px`,
      top: `${start.top}px`,
      width: `${start.width}px`,
      height: `${start.height}px`,
    });
    const duration = config.filed.duration * 1000;
    const animations = [
      // The same picture lands exactly on the mark, so one hands over to
      // the other at the end with nothing to blend.
      element.animate(
        [
          { transform: "none" },
          {
            transform: `translate(${left - start.left}px, ${icon.top - start.top}px) scale(${scale})`,
          },
        ],
        // Already on screen and moving: accelerate, then brake.
        { duration, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "both" },
      ),
      element.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 1,
        delay: duration,
        fill: "both",
      }),
      mark.current.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 1,
        delay: duration,
        fill: "both",
      }),
      ...[plate.current, label.current].map((target) =>
        target!.animate(
          [{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }],
          {
            duration,
            easing: "cubic-bezier(0.23, 1, 0.32, 1)",
            fill: "both",
          },
        ),
      ),
      hint.current!.animate(
        [
          { opacity: 0, transform: "translateY(3px)" },
          { opacity: 1, transform: "none" },
        ],
        {
          duration: 300,
          delay: duration,
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "both",
        },
      ),
    ];
    return () => animations.forEach((animation) => animation.cancel());
    // Only the arrival flies; `from` changes with every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.filed} style={{ opacity: 1 - fade }}>
      <div ref={plate} className={styles.filedPlate}>
        <span className={styles.filedRow}>
          <PartnerMark ref={mark} src={src} />
          <span ref={label}>Partner</span>
        </span>
        <span ref={hint} className={styles.filedHint}>
          You hold the other half.
        </span>
      </div>
      {src && !reducedMotion && (
        // A picture drawn on the page from the 3D half, not a file to
        // optimize.
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={picture} src={src} alt="" className={styles.filedPicture} />
      )}
    </div>
  );
}

// The Partner page in the app: both halves, laid together at the tear, and
// Jordan's half as Partner's mark in the sidebar.
export function PartnerPage({
  config,
  halves,
}: {
  config: Config;
  halves: Halves | null;
}) {
  const box = joinedBox(config);
  return (
    <div className={`${shell.root} ${styles.registerShell}`}>
      <aside className={`${shell.sidebar} ${styles.registerSidebar}`}>
        <div className={shell.sidebarInner} style={{ width: 232 }}>
          <nav className={shell.sidebarNav} aria-label="Settings navigation">
            <div className={shell.sidebarHeader}>
              <span className={shell.switcher}>
                <ChevronLeftIcon size={14} aria-hidden />
                <span className={shell.switcherName}>Back to app</span>
              </span>
            </div>
            <div className={shell.sidebarScroll}>
              <h2 className={shell.navHeading}>Settings</h2>
              <ul className={shell.navList}>
                <NavItem label="Profile">
                  <CircleUserRoundIcon size={14} className={shell.navIcon} />
                </NavItem>
                <NavItem label="Appearance">
                  <PaletteIcon size={14} className={shell.navIcon} />
                </NavItem>
                <NavItem label="Partner" current>
                  <PartnerMark
                    src={halves?.mark ?? null}
                    className={shell.navIcon}
                  />
                </NavItem>
              </ul>
            </div>
          </nav>
        </div>
      </aside>
      <div className={shell.main}>
        <div className={shell.panel}>
          <header className={shell.header}>
            <div className={shell.titleGroup}>
              <span className={shell.crumb}>Settings</span>
              <ChevronRightIcon
                size={12}
                className={shell.crumbSeparator}
                aria-hidden
              />
              <h1 className={shell.headerTitle}>Partner</h1>
            </div>
          </header>
          <div className={shell.body}>
            <main className={shell.content}>
              <div className={shell.settingsPage}>
                <div
                  className={styles.bondPaper}
                  style={{
                    width: config.partnerPage.width,
                    aspectRatio: `${box.right - box.left} / ${box.bottom - box.top}`,
                  }}
                >
                  {halves && (
                    // Pictures drawn on the page from the 3D card, not files
                    // to optimize.
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={halves.theirs} alt={`${FIRST_NAME}’s half`} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={halves.yours} alt="Your half" />
                    </>
                  )}
                </div>
                <section className={shell.settingsSection}>
                  <p className={shell.settingsIntro}>
                    Share costs like rent with one partner. They see the
                    purchases you share with them and the payments between you;
                    your categories, other transactions, and balances stay
                    private.
                  </p>
                  <Card>
                    <div className={shell.settingRow}>
                      <div className={shell.settingText}>
                        <span className={shell.settingLabel}>
                          Connected with {PARTNER}
                        </span>
                        <span className={shell.settingHint}>
                          A budget has room for one partner.
                        </span>
                      </div>
                    </div>
                  </Card>
                </section>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItem({
  label,
  current = false,
  children,
}: {
  label: string;
  current?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      <span
        className={shell.navItem}
        aria-current={current ? "page" : undefined}
      >
        {children}
        <span className={shell.navLabel}>{label}</span>
      </span>
    </li>
  );
}

// Jordan's half, pictured from the 3D card, at icon size. It keeps the
// half's shape, a little narrower than it is tall, in the middle of an
// icon's square box so labels line up.
function PartnerMark({
  src,
  className,
  ref,
}: {
  src: string | null;
  className?: string;
  ref?: React.Ref<HTMLImageElement>;
}) {
  return (
    // A picture drawn on the page from the 3D half, not a file to optimize.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src ?? undefined}
      alt=""
      width={MARK_SIZE}
      height={MARK_SIZE}
      className={`${styles.partnerMark} ${className ?? ""}`}
      style={{ visibility: src ? undefined : "hidden" }}
    />
  );
}
