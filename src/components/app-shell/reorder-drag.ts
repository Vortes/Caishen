"use client";

import { animate, useMotionValue, useReducedMotion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

// Dragging a row to reorder its list, like YNAB's plan: the grabbed row
// follows the pointer and a gap opens where it will land. On release it
// settles into the gap. The plan drags groups, or categories within and
// between groups; the sidebar drags accounts within their section.

// How far a press travels before it's a drag rather than a click.
const THRESHOLD = 4;
// Near the scroll area's top or bottom edge, the list scrolls by itself.
const EDGE = 48;
const EDGE_SPEED = 12;
// How long rows take to slide into place after a drop: --duration-panel.
export const SETTLE_MS = 260;
// --ease-panel.
export const EASE = [0.32, 0.72, 0, 1] as const;

type Drag = { id: string; order: string[] };

export function useReorderDrag<List extends HTMLElement = HTMLDivElement>({
  ids,
  enabled,
  onDrop,
  places,
}: {
  ids: string[];
  enabled: boolean;
  // Where the dragged row's top would sit at each index of the new order,
  // or null where it can't go, read as the drag starts. Without it the
  // places are evenly spaced, measured as the list changes under the drag.
  // Keys move the row by keyboard, which can skip places a pointer can use.
  places?: (
    id: string,
    list: List,
    by: "pointer" | "keys",
  ) => (number | null)[];
  // Saves the new order; calls done once it's saved or refused.
  onDrop: (order: string[], id: string, done: () => void) => void;
}) {
  const listRef = useRef<List>(null);
  const y = useMotionValue(0);
  // The top of the gap the row will land in, for lists that draw it over
  // their rows: it slides between places with the rows around it.
  const gap = useMotionValue(0);
  // Where the gap goes next. It starts sliding once the rows have moved
  // under it, so the two leave together.
  const gapTarget = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const [drag, setDrag] = useState<Drag | null>(null);
  // Pressed on a row: positions animate from here, so the fold that starts
  // a plan drag has its first frame measured.
  const [armed, setArmed] = useState(false);
  const [settling, setSettling] = useState(false);
  // Cancelled with Escape, the dragged row on its way back.
  const [returning, setReturning] = useState(false);
  // A dropped order, shown until the saved one arrives.
  const [held, setHeld] = useState<string[] | null>(null);
  const key = ids.join("\n");
  useEffect(() => setHeld(null), [key]);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  useLayoutEffect(() => {
    const target = gapTarget.current;
    gapTarget.current = null;
    if (target === null) return;
    void animate(gap, target, {
      duration: reduced ? 0 : SETTLE_MS / 1000,
      ease: EASE,
    });
  }, [drag, gap, reduced]);

  const save = (order: string[], id: string) => {
    if (order.every((value, index) => value === ids[index])) return;
    setHeld(order);
    onDrop(order, id, () => setHeld(null));
  };

  const start = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!enabled || drag || event.button !== 0) return;
    // Touch scrolls the list; a checkbox or + keeps its own clicks.
    if (event.pointerType === "touch") return;
    if ((event.target as Element).closest("label, [data-no-drag]")) return;
    const list = listRef.current;
    if (!list) return;
    const scroller = scrollParent(list);
    const startY = event.clientY;
    const grab = startY - event.currentTarget.getBoundingClientRect().top;
    let pointerY = startY;
    let order: string[] | null = null;
    let measured: (number | null)[] | null = null;
    let frame = 0;
    setArmed(true);

    const tops = () => measured ?? evenPlaces(list, ids.length);
    const top = () => pointerY - list.getBoundingClientRect().top - grab;
    const update = () => {
      if (!order) return;
      y.set(top());
      const places = tops();
      const index = nearest(places, top());
      if (index < 0 || order.indexOf(id) === index) return;
      gapTarget.current = places[index]!;
      const rest = order.filter((value) => value !== id);
      rest.splice(index, 0, id);
      order = rest;
      setDrag({ id, order: rest });
    };
    const scroll = () => {
      frame = 0;
      if (!order || !scroller) return;
      const box = scroller.getBoundingClientRect();
      const step =
        pointerY < box.top + EDGE
          ? -EDGE_SPEED
          : pointerY > box.bottom - EDGE
            ? EDGE_SPEED
            : 0;
      if (!step) return;
      scroller.scrollTop += step;
      update();
      frame = requestAnimationFrame(scroll);
    };

    const move = (moved: PointerEvent) => {
      pointerY = moved.clientY;
      if (!order) {
        if (Math.abs(pointerY - startY) < THRESHOLD) return;
        order = ids;
        measured = places?.(id, list, "pointer") ?? null;
        gap.set(tops()[ids.indexOf(id)] ?? 0);
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
        y.set(top());
        setDrag({ id, order });
        return;
      }
      update();
      if (!frame) frame = requestAnimationFrame(scroll);
    };
    const end = (keep: boolean) => {
      stop();
      if (!order) {
        setArmed(false);
        return;
      }
      // The release would click the row it was dragged by.
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true));
      const final = keep ? order : ids;
      if (!keep) {
        setDrag({ id, order: ids });
        setReturning(true);
      }
      const target = tops()[final.indexOf(id)] ?? y.get();
      const land = { duration: reduced ? 0 : 0.18, ease: EASE };
      void animate(gap, target, land);
      void animate(y, target, land).then(() => {
        setReturning(false);
        save(final, id);
        setDrag(null);
        setSettling(true);
        setTimeout(
          () => {
            setSettling(false);
            setArmed(false);
          },
          reduced ? 0 : SETTLE_MS,
        );
      });
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !order) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      end(false);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      scroller?.removeEventListener("scroll", update);
      cancelAnimationFrame(frame);
      document.body.style.userSelect = "";
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    scroller?.addEventListener("scroll", update);
    cleanup.current = stop;
  };

  // Alt+Up and Alt+Down move a row to the next place it can go, without
  // motion.
  const nudge = (id: string, by: -1 | 1) => {
    const from = ids.indexOf(id);
    if (!enabled || from < 0) return;
    const list = listRef.current;
    const open = list && places?.(id, list, "keys");
    let to = from + by;
    while (open && to >= 0 && to < ids.length && open[to] == null) to += by;
    if (to < 0 || to >= ids.length) return;
    const order = ids.filter((value) => value !== id);
    order.splice(to, 0, id);
    save(order, id);
  };

  return {
    listRef,
    enabled,
    y,
    gap,
    drag,
    returning,
    settling,
    // Positions animate only around a drag.
    animating: armed || drag !== null || settling,
    order: drag?.order ?? held ?? ids,
    start,
    nudge,
  };
}

// Every row is the same height while dragging, so the places are evenly
// spaced from the first.
function evenPlaces(list: HTMLElement, count: number) {
  const wraps = list.querySelectorAll<HTMLElement>(
    ":scope > [data-reorder-slot]",
  );
  const first = wraps[0]?.offsetTop ?? 0;
  const pitch = wraps[1] ? wraps[1].offsetTop - first : 1;
  return Array.from({ length: count }, (_, index) => first + index * pitch);
}

// The index of the place closest to top, or -1 when there's none.
function nearest(places: (number | null)[], top: number) {
  let best = -1;
  for (const [index, place] of places.entries())
    if (
      place != null &&
      (best < 0 || Math.abs(place - top) < Math.abs(places[best]! - top))
    )
      best = index;
  return best;
}

function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
