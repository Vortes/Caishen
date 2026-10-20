"use client";

import { Popover } from "radix-ui";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pie } from "~/components/dither-kit/pie";
import { PieChart } from "~/components/dither-kit/pie-chart";
import type { SpendingEntry } from "~/domain/spending";
import { money } from "../model";
import type { Highlight } from "./chart-utils";
import { ChartBridge, configOf } from "./dither-charts";
import type { ChartItem, DrillPath } from "./report";
import { SlicePopover } from "./slice-popover";
import styles from "./reflect.module.css";

// Spending Breakdown's ring leads the page, as in YNAB: it takes the width
// the column offers, minus room for the slice labels on either side.
const RING = { min: 320, max: 640 };
const LABEL = { gap: 22, height: 36, room: 180 };

type Label = { item: ChartItem; x: number; y: number; side: "left" | "right" };

// Each label starts beside its slice's midpoint, then labels on the same side
// are pushed apart so none overlap; the push runs downward, then back up from
// the bottom edge.
function placeLabels(
  items: ChartItem[],
  total: number,
  width: number,
  height: number,
  ring: number,
): Label[] {
  const cx = width / 2;
  const cy = height / 2;
  const radius = ring / 2 + LABEL.gap;
  let angle = 0;
  const labels = items.map((item): Label => {
    const span = total ? (item.total / total) * Math.PI * 2 : 0;
    const mid = angle + span / 2;
    angle += span;
    return {
      item,
      x: cx + radius * Math.sin(mid),
      y: cy - radius * Math.cos(mid),
      side: Math.sin(mid) >= 0 ? "right" : "left",
    };
  });
  for (const side of ["left", "right"] as const) {
    const column = labels
      .filter((label) => label.side === side)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < column.length; i++)
      column[i]!.y = Math.max(column[i]!.y, column[i - 1]!.y + LABEL.height);
    const floor = height - LABEL.height / 2;
    for (let i = column.length - 1; i >= 0; i--) {
      const limit =
        i === column.length - 1 ? floor : column[i + 1]!.y - LABEL.height;
      column[i]!.y = Math.max(LABEL.height / 2, Math.min(column[i]!.y, limit));
    }
  }
  return labels;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry?.contentRect.width ?? 0),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

// Clicking a slice opens its transactions where it was clicked, like YNAB;
// opening one goes to it in its account. The ranked list still drills down.
export function BreakdownChart({
  items,
  total,
  highlight,
  itemEntries,
  onOpenEntry,
}: {
  items: ChartItem[];
  total: number;
  highlight: Highlight;
  itemEntries: Record<string, SpendingEntry[]>;
  onOpenEntry: (entry: SpendingEntry) => void;
}) {
  const [frame, width] = useWidth();
  const labelled = width >= RING.min + LABEL.room * 2;
  const ring = Math.round(
    labelled
      ? Math.min(RING.max, width - LABEL.room * 2)
      : Math.min(RING.min, width),
  );
  const height = ring + (labelled ? LABEL.height * 2 : 0);

  // Dither Kit replays its entrance whenever `data` changes identity, so the
  // rows are built once per report rather than on every hover.
  const data = useMemo(
    () => items.map((item) => ({ name: item.id, value: item.total })),
    [items],
  );
  const config = useMemo(() => configOf(items), [items]);
  const labels = useMemo(
    () => (labelled ? placeLabels(items, total, width, height, ring) : []),
    [items, total, width, height, ring, labelled],
  );
  const [hovered, setHovered] = useState<ChartItem>();
  const [open, setOpen] = useState<{
    item: ChartItem;
    x: number;
    y: number;
  } | null>(null);
  const focused =
    open?.item ??
    hovered ??
    items.find((item) => item.id === highlight.id) ??
    undefined;
  const drill: DrillPath | undefined = open?.item.drill;

  return (
    <div ref={frame} className={styles.stageFrame}>
      {width > 0 && (
        <Popover.Root
          open={Boolean(open)}
          onOpenChange={(value) => {
            if (!value) setOpen(null);
          }}
        >
          <div className={styles.stage} style={{ height }} aria-hidden>
            {open && (
              <Popover.Anchor asChild>
                <span
                  className={styles.anchor}
                  style={{ left: open.x, top: open.y }}
                />
              </Popover.Anchor>
            )}
            {/* The kit's canvas takes the pointer, so the click is handled on
                the frame around it, for whichever slice the chart reports as
                hovered. */}
            <div
              className={`${styles.dither} ${styles.ditherDonut}`}
              style={{ width: ring, height: ring }}
              data-clickable={hovered ? "" : undefined}
              onClick={(event) => {
                if (!hovered) return;
                const bounds =
                  event.currentTarget.parentElement!.getBoundingClientRect();
                setOpen({
                  item: hovered,
                  x: event.clientX - bounds.left,
                  y: event.clientY - bounds.top,
                });
              }}
            >
              <PieChart
                data={data}
                config={config}
                dataKey="value"
                nameKey="name"
                innerRadius={0.62}
                margins={{ top: 0, right: 0, bottom: 0, left: 0 }}
                bloom="off"
              >
                <Pie variant="gradient" />
                <ChartBridge
                  focusId={open?.item.id ?? highlight.id}
                  items={items}
                  onHover={setHovered}
                />
              </PieChart>
              <div className={styles.donutCenter}>
                <span>{focused ? focused.name : "Total spending"}</span>
                <strong>{money(focused ? focused.total : total)}</strong>
                {focused && (
                  <span>
                    {Math.round((focused.total / total) * 100)}% of spending
                  </span>
                )}
              </div>
            </div>
            {labels.map(({ item, x, y, side }) => (
              <div
                key={item.id}
                className={styles.sliceLabel}
                data-side={side}
                data-dim={
                  (focused !== undefined && focused.id !== item.id) || undefined
                }
                style={{ left: x, top: y }}
              >
                <span>{item.name}</span>
                <span>
                  {money(item.total)} · {Math.round((item.total / total) * 100)}
                  %
                </span>
              </div>
            ))}
          </div>
          {open && (
            <SlicePopover
              item={open.item}
              entries={itemEntries[open.item.id] ?? []}
              onOpenEntry={(entry) => {
                setOpen(null);
                onOpenEntry(entry);
              }}
              onDrill={
                drill?.group && !drill.categoryId
                  ? () => {
                      setOpen(null);
                      highlight.drill(drill);
                    }
                  : undefined
              }
            />
          )}
        </Popover.Root>
      )}
    </div>
  );
}
