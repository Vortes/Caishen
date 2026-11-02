"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pie } from "~/components/dither-kit/pie";
import { PieChart } from "~/components/dither-kit/pie-chart";
import { Popover } from "~/components/ui/popover";
import type { SpendingEntry } from "~/domain/spending";
import { money } from "../model";
import type { Highlight } from "./chart-utils";
import { ChartBridge, configOf } from "./dither-charts";
import type { ChartItem, DrillPath } from "./report";
import { RingSkeleton } from "./ring-skeleton";
import { SlicePanel } from "./slice-popover";
import styles from "./reflect.module.css";

// Spending Breakdown's ring leads the page, as in YNAB: alone, it takes all
// the room the report offers; with the list under it, the column's width.
// Either way it leaves space for the slice labels around it.
const RING = { min: 320, max: 640 };
const LABEL = { gap: 22, height: 36, room: 180 };
// The ring's clockwise sweep-in, in ms.
const SWEEP = 900;

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

// The ring's diameter and the stage around it. Filling, the stage is the
// frame's height; otherwise it's as tall as the ring and its labels.
function stageSize(width: number, height: number, fill: boolean) {
  const labelled = width >= RING.min + LABEL.room * 2;
  const labels = labelled ? LABEL.height * 2 : 0;
  const across = labelled ? width - LABEL.room * 2 : width;
  const ring = Math.max(
    0,
    Math.round(
      fill ? Math.min(across, height - labels) : Math.min(RING.max, across),
    ),
  );
  return { labelled, ring, height: fill ? height : ring + labels };
}

function useSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Measured before the first paint: the observer's first report comes
    // after it, and a ring drawn at zero size for a frame flashes.
    const { width, height } = element.getBoundingClientRect();
    setSize({ width, height });
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry?.contentRect.width ?? 0,
        height: entry?.contentRect.height ?? 0,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

// Clicking a slice opens its transactions where it was clicked, like YNAB;
// opening one goes to it in its account. The ranked list still drills down.
export function BreakdownChart({
  items,
  total,
  highlight,
  itemEntries,
  onOpenEntry,
  afterSkeleton,
  onSkeletonGone,
  fill,
}: {
  items: ChartItem[];
  total: number;
  highlight: Highlight;
  itemEntries: Record<string, SpendingEntry[]>;
  onOpenEntry: (entry: SpendingEntry) => void;
  // The skeleton's ring was just on screen: it stays under the chart's
  // sweep-in, clearing as the slices reach it.
  afterSkeleton: boolean;
  onSkeletonGone: () => void;
  // Nothing follows the chart, so it takes the report's full height.
  fill: boolean;
}) {
  const [frame, size] = useSize();
  const { labelled, ring, height } = stageSize(size.width, size.height, fill);
  const { width } = size;

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
  const [lastOpen, setLastOpen] = useState(open);
  if (open && open !== lastOpen) setLastOpen(open);
  const displayed = open ?? lastOpen;
  const focused =
    open?.item ??
    hovered ??
    items.find((item) => item.id === highlight.id) ??
    undefined;
  const drill: DrillPath | undefined = open?.item.drill;

  return (
    <div
      ref={frame}
      className={styles.stageFrame}
      style={fill ? undefined : { height }}
    >
      {width > 0 && (
        <div className={styles.stage} aria-hidden>
          {displayed && (
            <Popover
              label={`${displayed.item.name} transactions`}
              anchor={
                <span
                  className={styles.anchor}
                  style={{ left: displayed.x, top: displayed.y }}
                />
              }
              open={Boolean(open)}
              onOpenChange={(value) => {
                if (!value) setOpen(null);
              }}
              autoFocus
              side="top"
              align="center"
              size="wide"
              arrow
            >
              <SlicePanel
                item={displayed.item}
                entries={itemEntries[displayed.item.id] ?? []}
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
                onClose={() => setOpen(null)}
              />
            </Popover>
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
            {afterSkeleton && (
              <div className={styles.ringUnder}>
                <RingSkeleton
                  size={ring}
                  sweep={SWEEP}
                  onSwept={onSkeletonGone}
                />
              </div>
            )}
            <PieChart
              data={data}
              animationDuration={SWEEP}
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
                {money(item.total)} · {Math.round((item.total / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The stage while spending loads, at the size the ring will take, so
// nothing moves when it arrives. The ring is a dithered bone; the
// center keeps its label and holds the total's line empty.
export function BreakdownSkeleton({ fill }: { fill: boolean }) {
  const [frame, size] = useSize();
  const { ring, height } = stageSize(size.width, size.height, fill);
  return (
    <div
      ref={frame}
      className={styles.stageFrame}
      style={fill ? undefined : { height }}
    >
      {size.width > 0 && (
        <div className={styles.stage}>
          <div
            className={styles.ditherDonut}
            style={{ width: ring, height: ring }}
          >
            <RingSkeleton size={ring} />
            <div className={styles.donutCenter}>
              <span>Total spending</span>
              <strong />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
