"use client";

import {
  ChartPieIcon,
  ChevronRightIcon,
  InfoIcon,
  LoaderCircleIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "~/components/ui/segmented-control";
import { money, shortDay } from "../model";
import { useShellData } from "../shell-data";
import shell from "../shell.module.css";
import type { Highlight } from "./chart-utils";
import type { SpendingEntry } from "~/domain/spending";
import { BreakdownChart } from "./breakdown-chart";
import { DitherTrends } from "./dither-charts";
import {
  rangeLabel,
  resolveRange,
  type DrillPath,
  type Grouping,
  type ReflectFilters,
  type Report,
  type ReportKind,
} from "./report";
import { SpendingList } from "./spending-list";
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

  if (error)
    return (
      <Notice icon={InfoIcon} title="Spending couldn’t load." role="alert">
        {error}
      </Notice>
    );
  if (!report)
    return (
      <Notice
        icon={LoaderCircleIcon}
        title="Adding up your spending…"
        role="status"
        busy
      />
    );

  const { from, to } = resolveRange(filters.range, month.current, month.start);
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
    !report.items.length && !report.inflows.length && !report.entries.length;
  const drilled = Boolean(path.group ?? path.categoryId);

  return (
    <div className={`${shell.list} ${styles.report}`}>
      {drilled && <Crumbs path={path} narrowed={narrowed} onPath={onPath} />}
      <div className={styles.headline}>
        <div className={styles.headlineFigure}>
          <span>Total spending</span>
          <strong>{money(report.total)}</strong>
        </div>
        {report.level !== "transactions" && !path.group && (
          <GroupingSwitch value={grouping} onChange={onGroupingChange} />
        )}
      </div>
      {!report.months.length ? (
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
          <Stats report={report} />
          {kind === "trends" && report.total > 0 && (
            <MonthList report={report} />
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

// YNAB's summary under the chart, for exactly what the chart shows.
function Stats({ report }: { report: Report }) {
  const stats: { label: string; value: string; detail?: string }[] = [
    { label: "Average monthly spending", value: money(report.average) },
    { label: "Average daily spending", value: money(report.dailyAverage) },
    {
      label:
        report.level === "transactions"
          ? "Most frequent payee"
          : "Most frequent category",
      value: report.frequent?.name ?? "None",
      detail: report.frequent
        ? `${report.frequent.count} ${report.frequent.count === 1 ? "transaction" : "transactions"}`
        : undefined,
    },
    {
      label: "Largest outflow",
      value: report.largest?.payee ?? "None",
      detail: report.largest
        ? `${money(report.largest.amount)} · ${shortDay(report.largest.date)}`
        : undefined,
    },
  ];
  return (
    <dl className={styles.stats}>
      {stats.map((stat) => (
        <div key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>
            <span className={shell.truncate} title={stat.value}>
              {stat.value}
            </span>
            {stat.detail && <small>{stat.detail}</small>}
          </dd>
        </div>
      ))}
    </dl>
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
function MonthList({ report }: { report: Report }) {
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
      {report.trend.map((month) => (
        <div
          key={month.month}
          className={`${styles.itemColumns} ${styles.staticRow}`}
        >
          <span>{monthLabel(month.month)}</span>
          <span className={`${shell.numeric} ${shell.muted}`} data-optional>
            {money(month.total - report.average, true)}
          </span>
          <span />
          <span className={shell.numeric}>{money(month.total)}</span>
        </div>
      ))}
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

function Notice({
  icon: Icon,
  title,
  role,
  busy,
  children,
}: {
  icon: LucideIcon;
  title: string;
  role?: "status" | "alert";
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`${shell.empty} ${styles.notice}`} role={role}>
      <Icon
        size={18}
        className={`${styles.noticeIcon} ${busy ? shell.spin : ""}`}
        aria-hidden
      />
      <p className={styles.noticeText}>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}
