"use client";

import { ChevronRightIcon } from "lucide-react";
import { Skeleton } from "~/components/ui/skeleton";
import { money } from "../model";
import shell from "../shell.module.css";
import { seriesColor, type Highlight } from "./chart-utils";
import { OTHER, type DrillPath, type Report } from "./report";

const nounOf = (level: Report["level"]) =>
  level === "groups" ? "Category groups" : "Categories";
import styles from "./reflect.module.css";

// YNAB's ranked sidebar: every item at this level, largest first, each with
// its total and a bar for its share of spending. It is also the chart's table
// view, so it renders wherever there's room: the details panel, or under the
// chart when that panel is closed.
export function SpendingList({
  report,
  path,
  highlight,
}: {
  report: Report;
  path: DrillPath;
  highlight: Highlight;
}) {
  const noun = nounOf(report.level);
  return (
    <div className={styles.spendingList}>
      <div role="group" aria-label={`${noun} by spending`}>
        <div className={styles.listHeader} aria-hidden>
          <span>{noun}</span>
          <span>Total spending</span>
        </div>
        {report.items.map((item) => {
          const chartId = item.slot === null ? OTHER : item.id;
          const percent = formatShare(item.share);
          return (
            <button
              type="button"
              key={item.id}
              className={styles.listRow}
              data-active={highlight.id === chartId || undefined}
              aria-label={`${item.name}, ${money(item.total)}, ${percent} of spending`}
              onPointerEnter={() => highlight.set(chartId)}
              onPointerLeave={() => highlight.set(null)}
              onFocus={() => highlight.set(chartId)}
              onBlur={() => highlight.set(null)}
              onClick={() => highlight.drill(item.drill)}
            >
              <span className={styles.listName}>
                <span className={shell.truncate}>{item.name}</span>
                <ChevronRightIcon
                  size={13}
                  className={styles.drillIcon}
                  aria-hidden
                />
              </span>
              <span className={styles.listAmount}>{money(item.total)}</span>
              <span className={styles.shareLine} aria-hidden>
                <span
                  className={styles.shareBar}
                  style={{
                    width: `calc((100% - var(--label)) * ${Math.max(item.share, 0.005)})`,
                    background: seriesColor(item.slot),
                  }}
                />
                <span className={styles.sharePercent}>{percent}</span>
              </span>
            </button>
          );
        })}
      </div>
      {report.inflows.length > 0 && (
        <div role="group" aria-label="Positive inflow categories">
          <div className={styles.listHeader} aria-hidden>
            <span>Positive inflow</span>
            <span>Net inflow</span>
          </div>
          {report.inflows.map((item) => (
            <button
              type="button"
              key={item.id}
              className={styles.listRow}
              onClick={() =>
                highlight.drill({
                  group: path.group ?? item.group,
                  categoryId: item.id,
                })
              }
            >
              <span className={styles.listName}>
                <span className={shell.truncate}>{item.name}</span>
                <ChevronRightIcon
                  size={13}
                  className={styles.drillIcon}
                  aria-hidden
                />
              </span>
              <span className={styles.listAmount} data-inflow>
                {money(item.total, true)}
              </span>
            </button>
          ))}
        </div>
      )}
      <Note />
    </div>
  );
}

// Ranked largest first, so the share bars shrink down the list.
const rows: [name: number, amount: number, share: number][] = [
  [96, 64, 180],
  [120, 60, 132],
  [72, 56, 104],
  [104, 56, 84],
  [64, 52, 64],
  [112, 48, 52],
  [84, 48, 40],
  [56, 44, 28],
  [92, 40, 20],
  [76, 40, 12],
];

// The ranked list while spending loads: its headers and note show as
// themselves, and every row's name, total, and share is a bone.
export function SpendingListSkeleton({ level }: { level: Report["level"] }) {
  return (
    <div className={styles.spendingList}>
      <div>
        <div className={styles.listHeader}>
          <span>{nounOf(level)}</span>
          <span>Total spending</span>
        </div>
        {rows.map(([name, amount, share], index) => (
          <div key={index} className={styles.listRow}>
            <Skeleton width={name} />
            <Skeleton width={amount} />
            <span className={styles.shareLine}>
              <Skeleton shape="funding-bar" width={share} />
              <span className={styles.sharePercent}>
                <Skeleton width={24} />
              </span>
            </span>
          </div>
        ))}
      </div>
      <Note />
    </div>
  );
}

function Note() {
  return (
    <p className={styles.listNote}>
      Spending is your share. Shared expenses count only your part; card
      payments, transfers, and income don’t count.
    </p>
  );
}

export function formatShare(share: number) {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}
