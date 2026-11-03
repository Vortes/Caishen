"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart } from "~/components/dither-kit/bar-chart";
import { Bar } from "~/components/dither-kit/bar";
import {
  useChartPart,
  type ChartConfig,
} from "~/components/dither-kit/chart-context";
import { useCommonChart } from "~/components/dither-kit/common-context";
import { Grid } from "~/components/dither-kit/grid";
import { Tooltip } from "~/components/dither-kit/tooltip";
import { XAxis } from "~/components/dither-kit/x-axis";
import { YAxis } from "~/components/dither-kit/y-axis";
import { money } from "../model";
import { compactMoney, ditherColor, type Highlight } from "./chart-utils";
import type { ChartItem, Report } from "./report";
import styles from "./reflect.module.css";

// Spending Trends, and the pieces both reports share, drawn with Dither Kit's
// ordered-dither canvas. Hovering a row in the ranked list spotlights its
// segment, and clicking a segment drills down.

export function configOf(items: ChartItem[]): ChartConfig {
  return Object.fromEntries(
    items.map((item) => [
      item.id,
      { label: item.name, color: ditherColor(item.slot) },
    ]),
  );
}

// The rows each chart last swept in with, kept across mounts. Dither Kit
// replays its entrance whenever `data` changes identity, so rows equal to the
// ones on screen keep their identity, and coming back to a chart that already
// showed them skips the entrance.
const shown = new Map<string, string>();

export function useChartRows<T>(chart: string, rows: T[]) {
  const signature = useMemo(() => JSON.stringify(rows), [rows]);
  const [state, setState] = useState(() => ({
    signature,
    rows,
    animate: shown.get(chart) !== signature,
  }));
  useEffect(() => {
    shown.set(chart, signature);
  }, [chart, signature]);
  if (state.signature === signature) return state;
  const next = { signature, rows, animate: true };
  setState(next);
  return next;
}

// Lives inside a chart root: spotlights the focused item (from the ranked
// list, or an open popover) and reports which item the pointer is over.
export function ChartBridge({
  focusId,
  items,
  onHover,
}: {
  focusId: string | null;
  items: ChartItem[];
  onHover?: (item: ChartItem | undefined) => void;
}) {
  const { setFocusDataKey, hoverIndex, names } = useCommonChart();
  useEffect(() => {
    setFocusDataKey(focusId);
  }, [focusId, setFocusDataKey]);
  const hovered =
    hoverIndex === null
      ? undefined
      : items.find((item) => item.id === names[hoverIndex]);
  useEffect(() => {
    onHover?.(hovered);
  }, [hovered, onHover]);
  return null;
}
ChartBridge.chartLayer = "dom" as const;

const shortMonth = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

// The kit's reference line labels inside the plot, where the last column can
// cover it; this one labels in the right margin like the flat chart.
function AverageLine({ value }: { value: number }) {
  const chart = useChartPart("AverageLine", "bar");
  if (!chart.ready) return null;
  const y = chart.y(value);
  return (
    <g className={styles.average}>
      <line x1={0} x2={chart.plot.width} y1={y} y2={y} />
      <text x={chart.plot.width + 8} y={y} dominantBaseline="middle">
        Avg {compactMoney(value)}
      </text>
    </g>
  );
}

export function DitherTrends({
  items,
  trend,
  average,
  highlight,
}: {
  items: ChartItem[];
  trend: Report["trend"];
  average: number;
  highlight: Highlight;
}) {
  const { rows: data, animate } = useChartRows(
    "trends",
    useMemo(
      () =>
        trend.map((month) => ({
          label: shortMonth(month.month),
          ...month.values,
        })),
      [trend],
    ),
  );
  const config = useMemo(() => configOf(items), [items]);
  return (
    <div className={`${styles.dither} ${styles.ditherTrends}`}>
      <BarChart
        data={data}
        animate={animate}
        config={config}
        stackType="stacked"
        margins={{ top: 12, right: 64, bottom: 24, left: 52 }}
        bloom="off"
        onSelectionChange={(key) => {
          const item = items.find((entry) => entry.id === key);
          if (item?.drill) highlight.drill(item.drill);
        }}
      >
        <Grid strokeDasharray="0" />
        {items.map((item) => (
          <Bar
            key={item.id}
            dataKey={item.id}
            variant="gradient"
            isClickable={Boolean(item.drill)}
          />
        ))}
        {average > 0 && <AverageLine value={average} />}
        <XAxis
          dataKey="label"
          tickFormatter={(value) => String(value).split(" ")[0] ?? ""}
        />
        <YAxis tickFormatter={compactMoney} />
        <Tooltip labelKey="label" valueFormatter={(value) => money(value)} />
        <ChartBridge focusId={highlight.id} items={items} />
      </BarChart>
    </div>
  );
}
