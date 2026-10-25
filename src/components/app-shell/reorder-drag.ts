"use client";

import { animate, useMotionValue, useReducedMotion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

// Dragging a row to reorder its list, like YNAB's plan: the grabbed row
// follows the pointer and a gap opens where it will land. On release it
// settles into the gap. The plan drags category groups, each folded to its
// header while one moves; the sidebar drags accounts within their section.

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
}: {
  ids: string[];
  enabled: boolean;
  // Saves the new order; calls done once it's saved or refused.
  onDrop: (order: string[], id: string, done: () => void) => void;
}) {
  const listRef = useRef<List>(null);
  const y = useMotionValue(0);
  const reduced = useReducedMotion();
  const [drag, setDrag] = useState<Drag | null>(null);
  // Pressed on a row: positions animate from here, so the fold that starts
  // a plan drag has its first frame measured.
  const [armed, setArmed] = useState(false);
  const [settling, setSettling] = useState(false);
  // A dropped order, shown until the saved one arrives.
  const [held, setHeld] = useState<string[] | null>(null);
  const key = ids.join("\n");
  useEffect(() => setHeld(null), [key]);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

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
    let frame = 0;
    setArmed(true);

    // Every row is the same height while dragging, so the slots are evenly
    // spaced from the first.
    const slots = () => {
      const wraps = list.querySelectorAll<HTMLElement>("[data-reorder-slot]");
      const first = wraps[0]?.offsetTop ?? 0;
      const pitch = wraps[1] ? wraps[1].offsetTop - first : 1;
      return { first, pitch };
    };
    const top = () => pointerY - list.getBoundingClientRect().top - grab;
    const update = () => {
      if (!order) return;
      y.set(top());
      const { first, pitch } = slots();
      const index = Math.min(
        ids.length - 1,
        Math.max(0, Math.round((top() - first) / pitch)),
      );
      if (order.indexOf(id) === index) return;
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
      if (!keep) setDrag({ id, order: ids });
      const { first, pitch } = slots();
      void animate(y, first + final.indexOf(id) * pitch, {
        duration: reduced ? 0 : 0.18,
        ease: EASE,
      }).then(() => {
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

  // Alt+Up and Alt+Down move a row one place, without motion.
  const nudge = (id: string, by: -1 | 1) => {
    const from = ids.indexOf(id);
    const to = from + by;
    if (!enabled || from < 0 || to < 0 || to >= ids.length) return;
    const order = ids.filter((value) => value !== id);
    order.splice(to, 0, id);
    save(order, id);
  };

  return {
    listRef,
    enabled,
    y,
    drag,
    settling,
    // Positions animate only around a drag.
    animating: armed || drag !== null || settling,
    order: drag?.order ?? held ?? ids,
    start,
    nudge,
  };
}

function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}
