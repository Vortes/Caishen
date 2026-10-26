"use client";

import {
  ChartPieIcon,
  ChevronRightIcon,
  InfoIcon,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { Skeleton } from "~/components/ui/skeleton";
import { money, shortDay } from "../model";
import { useShellData } from "../shell-data";
import shell from "../shell.module.css";
import type { Highlight } from "./chart-utils";
import type { SpendingEntry } from "~/domain/spending";
import { BreakdownChart, BreakdownSkeleton } from "./breakdown-chart";
import { DitherTrends } from "./dither-charts";
import {
  levelOf,
  rangeLabel,
  resolveRange,
  type DrillPath,
  type Grouping,
  type ReflectFilters,
  type Report,
  type ReportKind,
} from "./report";
import { SpendingList, SpendingListSkeleton } from "./spending-list";
import type { SpendingReport } from "./use-spending-report";
import styles from "./reflect.module.css";

export function ReflectView({
  spending: { report, error },
  highlight,
  kind,
  grouping,
  onGroupingChange,
  filters,
  path,
  onPath,
  onFiltersChange,
  onOpenTransaction,
  showList,
}: {
  spending: SpendingReport;
  highlight: Highlight;
  kind: ReportKind;
  grouping: Grouping;
  onGroupingChange: (grouping: Grouping) => void;
  filters: ReflectFilters;
  path: DrillPath;
  onPath: (path: DrillPath) => void;
  onFiltersChange: (filters: ReflectFilters) => void;
  onOpenTransaction: (entry: SpendingEntry) => void;
  // The ranked list lives in the details panel; when that's closed it
  // renders here instead, so the chart's values are always on screen.
  showList: boolean;
}) {
  const { month } = useShellData();
  // Whether the skeleton showed and its ring hasn't handed off to the chart.
  const [ringShown, setRingShown] = useState(!report);
  const clearRing = useCallback(() => setRingShown(false), []);

  if (error)
    return (
      <Notice icon={InfoIcon} title="Spending couldn’t load." role="alert">
        {error}
      </Notice>
    );

  const { from, to, months } = resolveRange(
    filters.range,
    month.current,
    month.start,
  );
  const level = report?.level ?? levelOf(path, grouping);
  const narrowed = filters.categoryIds !== null || filters.accountIds !== null;
  const showAllDates =
    filters.range.preset !== "all" ? (
      <Button
        variant="quiet"
        size="sm"
        onClick={() =>
          onFiltersChange({ ...filters, range: { preset: "all" } })
        }
      >
        Show all dates
      </Button>
    ) : null;
  const clearFilters = narrowed ? (
    <Button
      variant="quiet"
      size="sm"
      onClick={() =>
        onFiltersChange({ ...filters, categoryIds: null, accountIds: null })
      }
    >
      Show all categories and accounts
    </Button>
  ) : null;
  const nothing =
    report &&
    !report.items.length &&
    !report.inflows.length &&
    !report.entries.length;
  const drilled = Boolean(path.group ?? path.categoryId);
  // The breakdown ring fills the report when nothing comes after it.
  const fill = kind === "breakdown" && !showList;

  // The crumbs, headline label, and grouping work without the spending, so
  // they stay up while it loads; only the amounts are bones.
  return (
    <div
      className={`${shell.list} ${styles.report}`}
      aria-busy={!report || undefined}
    >
      {!report && (
        <p className="sr-only" role="status">
          Adding up your spending…
        </p>
      )}
      {drilled && <Crumbs path={path} narrowed={narrowed} onPath={onPath} />}
      <div className={styles.headline}>
        <div className={styles.headlineFigure}>
          <span>Total spending</span>
          <strong>
            {report ? (
              money(report.total)
            ) : (
              <Skeleton shape="figure" width={128} />
            )}
          </strong>
        </div>
        {level !== "transactions" && !path.group && (
          <GroupingSwitch value={grouping} onChange={onGroupingChange} />
        )}
      </div>
      {!report ? (
        <div className={styles.skeleton} aria-hidden inert>
          {(kind === "trends" || level !== "transactions") && (
            <div
              className={styles.chartBand}
              data-kind={kind}
              data-fill={fill || undefined}
            >
              {kind === "breakdown" ? (
                <BreakdownSkeleton fill={fill} />
              ) : (
                <div className={styles.ditherTrends} />
              )}
            </div>
          )}
          {kind === "trends" && <MonthList months={months} />}
          {level === "transactions" ? (
            <EntryListSkeleton />
          ) : (
            showList && (
              <div className={styles.section}>
                <SpendingListSkeleton level={level} />
              </div>
            )
          )}
        </div>
      ) : !report.months.length ? (
        <Notice icon={ChartPieIcon} title="No months in this range.">
          Your budget starts in {rangeLabel(month.start, month.start)}.
          {showAllDates}
        </Notice>
      ) : nothing ? (
        <Notice
          icon={ChartPieIcon}
          title={`No spending in ${rangeLabel(from, to)}.`}
        >
          {narrowed
            ? "Your category or account filters may be hiding some."
            : "Spending shows up here once transactions are categorized."}
          {clearFilters ?? showAllDates}
        </Notice>
      ) : (
        <>
          {(kind === "trends" || report.level !== "transactions") &&
            report.total > 0 && (
              <section
                className={styles.chartBand}
                data-kind={kind}
                data-fill={fill || undefined}
                aria-label={
                  kind === "breakdown"
                    ? "Spending breakdown chart"
                    : "Spending trends chart"
                }
              >
                {kind === "breakdown" ? (
                  <BreakdownChart
                    items={report.chartItems}
                    total={report.total}
                    highlight={highlight}
                    itemEntries={report.itemEntries}
                    onOpenEntry={onOpenTransaction}
                    afterSkeleton={ringShown}
                    onSkeletonGone={clearRing}
                    fill={fill}
                  />
                ) : (
                  <DitherTrends
                    items={report.chartItems}
                    trend={report.trend}
                    average={report.average}
                    highlight={highlight}
                  />
                )}
              </section>
            )}
          {kind === "trends" && report.total > 0 && (
            <MonthList months={report.months} report={report} />
          )}
          {report.level === "transactions" ? (
            <EntryList report={report} onOpen={onOpenTransaction} />
          ) : (
            showList && (
              <div className={styles.section}>
                <SpendingList
                  report={report}
                  path={path}
                  highlight={highlight}
                />
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function GroupingSwitch({
  value,
  onChange,
}: {
  value: Grouping;
  onChange: (grouping: Grouping) => void;
}) {
  const options: [Grouping, string][] = [
    ["categories", "Categories"],
    ["groups", "Groups"],
  ];
  return (
    <SegmentedControl
      aria-label="Group by"
      value={value}
      onValueChange={(next) => onChange(next as Grouping)}
    >
      {options.map(([option, label]) => (
        <SegmentedControlItem key={option} value={option}>
          {label}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  );
}

function Crumbs({
  path,
  narrowed,
  onPath,
}: {
  path: DrillPath;
  narrowed: boolean;
  onPath: (path: DrillPath) => void;
}) {
  const { categories } = useShellData();
  const category = path.categoryId
    ? (categories.find((item) => item.id === path.categoryId)?.name ??
      "Uncategorized")
    : undefined;
  const crumbs: { label: string; to?: DrillPath }[] = [
    {
      label: narrowed ? "Some categories" : "All categories",
      to: path.group ? {} : undefined,
    },
    ...(path.group
      ? [
          {
            label: path.group,
            to: category ? { group: path.group } : undefined,
          },
        ]
      : []),
    ...(category ? [{ label: category }] : []),
  ];
  return (
    <nav className={styles.crumbs} aria-label="Report level">
      <ol>
        {crumbs.map((crumb, index) => (
          <li key={crumb.label}>
            {index > 0 && (
              <ChevronRightIcon
                size={12}
                className={styles.crumbSeparator}
                aria-hidden
              />
            )}
            {crumb.to ? (
              <button type="button" onClick={() => onPath(crumb.to!)}>
                {crumb.label}
              </button>
            ) : (
              <span aria-current="page">{crumb.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

// Each month's total, so the columns' values never depend on hovering them.
// The months come from the date filter, so they show while the totals load.
function MonthList({ months, report }: { months: string[]; report?: Report }) {
  const totals = new Map(report?.trend.map((month) => [month.month, month]));
  return (
    <div role="group" aria-label="Spending by month" className={styles.section}>
      <div
        className={`${styles.itemColumns} ${shell.columnHeader}`}
        aria-hidden
      >
        <span>Month</span>
        <span className={shell.numeric} data-optional>
          Versus average
        </span>
        <span />
        <span className={shell.numeric}>Total</span>
      </div>
      {months.map((month, index) => {
        const total = totals.get(month)?.total;
        return (
          <div
            key={month}
            className={`${styles.itemColumns} ${styles.staticRow}`}
          >
            <span>{monthLabel(month)}</span>
            <span className={`${shell.numeric} ${shell.muted}`} data-optional>
              {report && total !== undefined ? (
                money(total - report.average, true)
              ) : (
                <Skeleton width={versusWidths[index % versusWidths.length]} />
              )}
            </span>
            <span />
            <span className={shell.numeric}>
              {total !== undefined ? (
                money(total)
              ) : (
                <Skeleton width={widths[(index + 2) % widths.length]} />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EntryList({
  report,
  onOpen,
}: {
  report: Report;
  onOpen: (entry: SpendingEntry) => void;
}) {
  const { accounts, partner } = useShellData();
  return (
    <div role="group" aria-label="Transactions">
      <div
        className={`${styles.entryColumns} ${shell.columnHeader}`}
        aria-hidden
      >
        <span>Date</span>
        <span>Payee</span>
        <span data-optional>Account</span>
        <span className={shell.numeric}>Your share</span>
      </div>
      {report.entries.map((entry) => {
        const cells = (
          <>
            <span className={shell.muted}>{shortDay(entry.date)}</span>
            <span className={shell.truncate}>{entry.payee}</span>
            <span className={`${shell.truncate} ${shell.faint}`} data-optional>
              {entry.paidByYou
                ? (accounts.find((item) => item.id === entry.accountId)?.name ??
                  "Account")
                : `Paid by ${partner?.name ?? "your partner"}`}
            </span>
            <span
              className={shell.numeric}
              data-inflow={entry.amount < 0 || undefined}
            >
              {money(-entry.amount, true)}
            </span>
          </>
        );
        return entry.paidByYou ? (
          <button
            type="button"
            key={entry.id}
            className={`${styles.entryColumns} ${shell.row}`}
            title="Open in its account"
            onClick={() => onOpen(entry)}
          >
            {cells}
          </button>
        ) : (
          <div
            key={entry.id}
            className={`${styles.entryColumns} ${styles.staticRow}`}
          >
            {cells}
          </div>
        );
      })}
    </div>
  );
}

// Bone widths for amounts down a column, varied so they read as figures.
const widths = [64, 52, 72, 56, 68, 48];
const versusWidths = [56, 44, 64, 48];

// A category's transactions while they load: enough rows to fill the screen.
const entryRows: [payee: number, account: number][] = [
  [112, 72],
  [84, 96],
  [136, 64],
  [96, 88],
  [72, 72],
  [124, 104],
  [88, 64],
  [104, 80],
  [64, 96],
  [116, 72],
];

function EntryListSkeleton() {
  return (
    <div>
      <div className={`${styles.entryColumns} ${shell.columnHeader}`}>
        <span>Date</span>
        <span>Payee</span>
        <span data-optional>Account</span>
        <span className={shell.numeric}>Your share</span>
      </div>
      {entryRows.map(([payee, account], index) => (
        <div
          key={index}
          className={`${styles.entryColumns} ${styles.staticRow}`}
        >
          <Skeleton width={44} />
          <Skeleton width={payee} />
          <span data-optional>
            <Skeleton width={account} />
          </span>
          <span className={shell.numeric}>
            <Skeleton width={widths[index % widths.length]} />
          </span>
        </div>
      ))}
    </div>
  );
}

function Notice({
  icon: Icon,
  title,
  role,
  children,
}: {
  icon: LucideIcon;
  title: string;
  role?: "alert";
  children?: ReactNode;
}) {
  return (
    <div className={`${shell.empty} ${styles.notice}`} role={role}>
      <Icon size={18} className={styles.noticeIcon} aria-hidden />
      <p className={styles.noticeText}>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}
